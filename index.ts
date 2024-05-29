import { google, sheets_v4 } from 'googleapis';
import credentials from './credentials';
import { v4 as uid } from 'uuid';
import axios from 'axios';

interface SchemaField {
    type: 'string' | 'number' | 'boolean';
    required?: boolean;
    index?: number;
}

interface GoogleDBOptions {
    auth: any;
    spreadSheetLink: string;
    spreadSheetName: string;
    schema: { [key: string]: SchemaField };
}

class GoogleDB {
    private id: string | null;
    private gid: string | null;
    private spreadSheetName: string;
    private schema: { [key: string]: SchemaField };
    private isReady: Promise<string>;
    private googleAuth: any;
    private sheets: sheets_v4.Sheets;
    private headers: string[];

    constructor({ auth, spreadSheetLink, spreadSheetName, schema }: GoogleDBOptions) {
        const { id, gid } = this.extractIdAndGid(spreadSheetLink);
        this.id = id;
        this.gid = gid;
        this.spreadSheetName = spreadSheetName;
        this.schema = schema;
        this.headers = [];

        this.isReady = new Promise(async (resolve, reject) => {
            try {
                await this.addGoogleAuth(async () => await this.getGoogleAuth(auth));
                await this.addHeaders(schema);
                resolve("success");
            } catch (error) {
                resolve("reject");
            }
        });
    }

    private async addGoogleAuth(auth: () => Promise<any>): Promise<void> {
        this.googleAuth = await auth();
        this.sheets = google.sheets({
            version: 'v4',
            auth: this.googleAuth
        });
    }

    private async addHeaders(schema: { [key: string]: SchemaField }): Promise<sheets_v4.Schema$UpdateValuesResponse> {
        try {
            const getRes = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.id as string,
                range: `${this.spreadSheetName}!1:1`
            });

            let prevHeaders = getRes.data.values?.[0] || ["__ID"];
            const prevHeadersSet = new Set(prevHeaders);

            this.headers = prevHeaders;

            for (let key in schema) {
                if (!prevHeadersSet.has(key)) {
                    prevHeaders.push(key);
                }
            }

            for (let i = 0; i < prevHeaders.length; i++) {
                if (schema[prevHeaders[i]]) {
                    schema[prevHeaders[i]].index = i;
                }
            }

            const appendRes = await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.id as string,
                range: `${this.spreadSheetName}!A1`,
                valueInputOption: 'RAW',
                resource: {
                    values: [prevHeaders]
                }
            });
            return appendRes;
        } catch (error) {
            throw new Error(error as string);
        }
    }

    async create(data: { [key: string]: any }): Promise<{ [key: string]: any }> {
        await this.isReady;
        try {
            const newValues: any[] = [];
            const uniqueID = uid();
            newValues[0] = uniqueID;

            for (let key in this.schema) {
                if (this.schema[key].required && data[key] === undefined) {
                    throw new Error(`${key} field is required!`);
                }
                newValues[this.schema[key].index as number] = data[key];
            }

            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.id as string,
                range: this.spreadSheetName,
                valueInputOption: 'RAW',
                resource: { values: [newValues] },
            });

            return { ...data, __ID: uniqueID };
        } catch (error) {
            throw new Error((error as Error).message);
        }
    }

    async find(query: { [key: string]: any } = {}): Promise<any[]> {
        await this.isReady;
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.id as string,
                range: this.spreadSheetName,
            });
            const data = this.convertDataToJSONWithFilters(response.data.values as any[], query);
            return data;
        } catch (error) {
            console.error('Error fetching data from Google Sheets:', error);
            throw error;
        }
    }

    async findOne(query: { [key: string]: any } = {}): Promise<any> {
        await this.isReady;
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.id as string,
                range: this.spreadSheetName,
            });
            const data = this.convertDataToJSONWithFiltersOne(response.data.values as any[], query);
            return data;
        } catch (error) {
            console.error('Error fetching data from Google Sheets:', error);
            throw error;
        }
    }

    async update(query: { [key: string]: any }, newData: { [key: string]: any }): Promise<{ [key: string]: any }> {
        await this.isReady;
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.id as string,
                range: this.spreadSheetName,
            });
            let rowIndexToUpdate: number | undefined;
            let rowToUpdate: any[];
            const allData = response.data.values;

            if (allData) {
                for (let i = 1; i < allData.length; i++) {
                    let filtered = false;
                    for (let key in query) {
                        if (key === "__ID") {
                            if (allData[i][0] !== query[key]) {
                                filtered = true;
                                break;
                            }
                        } else if (allData[i][this.schema[key].index as number] !== query[key]) {
                            filtered = true;
                            break;
                        }
                    }
                    if (filtered) continue;
                    rowIndexToUpdate = i;
                    rowToUpdate = allData[i];
                    break;
                }
            }

            if (!rowToUpdate) throw new Error("Cannot find row with this query!");

            for (let key in this.schema) {
                if (newData[key] !== undefined) {
                    if (this.schema[key].type !== typeof newData[key]) {
                        throw new Error(`${key} field should be of type ${this.schema[key].type}`);
                    }
                    rowToUpdate[this.schema[key].index as number] = newData[key];
                }
            }

            const updateValues = [rowToUpdate]; 
            console.log(updateValues);

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.id as string,
                range: `${this.spreadSheetName}!A${rowIndexToUpdate! + 1}:${rowIndexToUpdate! + 1}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: updateValues },
            });

            for (let key in this.schema) {
                newData[key] = this.parseBooleanNumber(rowToUpdate[this.schema[key].index as number]);
            }

            return newData;
        } catch (error) {
            console.error('Error updating data in Google Sheets:', error);
            throw error;
        }
    }

    async delete(query: { [key: string]: any }): Promise<sheets_v4.Schema$UpdateValuesResponse> {
        await this.isReady;
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.id as string,
                range: this.spreadSheetName,
            });
            let rowIndexToUpdate: number | undefined;
            let rowToUpdate: any[];
            const allData = response.data.values;

            if (allData) {
                for (let i = 1; i < allData.length; i++) {
                    let filtered = false;
                    for (let key in query) {
                        if (key === "__ID") {
                            if (allData[i][0] !== query[key]) {
                                filtered = true;
                                break;
                            }
                        } else if (allData[i][this.schema[key].index as number] !== query[key]) {
                            filtered = true;
                            break;
                        }
                    }
                    if (filtered) continue;
                    rowIndexToUpdate = i;
                    rowToUpdate = allData[i];
                    break;
                }
            }

            if (!rowToUpdate) throw new Error("Cannot find row with this query!");

            rowToUpdate.fill("");
            const updateValues = [rowToUpdate]; 
            console.log(updateValues);

            const updateResponse = await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.id as string,
                range: `${this.spreadSheetName}!A${rowIndexToUpdate! + 1}:${rowIndexToUpdate! + 1}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: updateValues },
            });

            return updateResponse;
        } catch (error) {
            console.error('Error deleting data from Google Sheets:', error);
            throw error;
        }
    }

    private convertDataToJSONWithFilters(data: any[], query: { [key: string]: any }): any[] {
        const keys = ["__ID", ...Object.keys(this.schema)];
        const jsonData: any[] = [];

        for (let i = 1; i < data.length; i++) {
            let filtered = false;
            for (let key in query) {
                if (key === "__ID") {
                    if (data[i][0] !== query[key]) {
                        filtered = true;
                        break;
                    }
                } else if (data[i][this.schema[key].index as number] !== query[key]) {
                    filtered = true;
                    break;
                }
            }
            if (filtered) continue;

            const row = data[i];
            const tempRow = [...data[i]];
            tempRow[0] = "";
            const rowJoin = tempRow.join("");
            if (rowJoin === "") continue;

            const obj: { [key: string]: any } = {};
            for (let j = 0; j < keys.length; j++) {
                obj[keys[j]] = this.parseBooleanNumber(row[j] || ""); 
            }

            jsonData.push(obj);
        }
        return jsonData;
    }

    private convertDataToJSONWithFiltersOne(data: any[], query: { [key: string]: any }): any | null {
        const keys = ["__ID", ...Object.keys(this.schema)];

        for (let i = 1; i < data.length; i++) {
            let filtered = false;
            for (let key in query) {
                if (key === "__ID") {
                    if (data[i][0] !== query[key]) {
                        filtered = true;
                        break;
                    }
                } else if (data[i][this.schema[key].index as number] !== query[key]) {
                    filtered = true;
                    break;
                }
            }
            if (filtered) continue;

            const row = data[i];
            const tempRow = [...data[i]];
            tempRow[0] = "";
            const rowJoin = tempRow.join("");
            if (rowJoin === "") continue;

            const obj: { [key: string]: any } = {};
            for (let j = 0; j < keys.length; j++) {
                obj[keys[j]] = this.parseBooleanNumber(row[j] || ""); 
            }

            return obj;
        }
        return null;
    }

    private parseBooleanNumber(val: string): any {
        if (val === "TRUE") return true;
        if (val === "FALSE") return false;

        const num = Number(val);
        if (!isNaN(num) && val !== "") {
            return num;
        }

        return val;
    }

    private extractIdAndGid(url: string): { id: string | null, gid: string | null } {
        const idMatch = url.match(/\/d\/(.*)\/edit/);
        const gidMatch = url.match(/gid=(\d+)/);

        const id = idMatch ? idMatch[1] : null;
        const gid = gidMatch ? gidMatch[1] : null;

        return { id, gid };
    }

    private async getGoogleAuth(auth: any): Promise<any> {
        if (auth.refreshToken) {
            const oAuth2Client = new google.auth.OAuth2({
                clientId: auth.CLIENT_ID,
                clientSecret: auth.CLIENT_SECRET,
                redirectUri: auth.REDIRECT_URI
            });

            oAuth2Client.setCredentials({
                refresh_token: auth.refreshToken
            });
            return oAuth2Client;
        } else {
            const tempAuth = new google.auth.GoogleAuth({
                credentials: auth,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            return await tempAuth.getClient();
        }
    }
}


export { GoogleDB }