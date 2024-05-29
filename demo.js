import { GoogleDB } from "./index.ts";

const slmSchema = {
    name: { type: "string", required: true },
    contact: { type: "number", required: true },
    isKid: { type: "boolean", required: true },
    isAdult: { type: "boolean", required: true },
};

const sheetLink = `https://docs.google.com/spreadsheets/d/1Z5FFXPsi_1wrq-DiuDtK-qfZz_pC6za0ZJXR4JHyIbs/edit#gid=2076195736`;

const newDB = new GoogleDB({ auth: credentials, schema: slmSchema, spreadSheetLink: sheetLink, spreadSheetName: "Sheet9" });

// newDB.create({
//     name: "Raghbir", contact: "91011", isAdult: true, isKid: false
// }).then(res => {
//     console.log(res);
// }).catch(err => console.log(err));

// newDB.findOne({ name: 'Raghbir S', contact: "910115" }).then(res => console.log(res));

// newDB.update({ __ID: "cd89463c-c465-41b5-ac22-3d40abeeebbf" }, {
//     name: "raghbir", contact:3939745, isKid:true
// }).then(res => console.log(res));

// newDB.delete({ __ID: "dfcbc396-197a-492a-9b88-6fb95aeb3a16" }).then(res => console.log(res));
