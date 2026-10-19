// Human-readable identifier formats. All generated through atomic DB sequences.
import { nextIdentifier } from "./utils/sequence.js";

export const ID_FORMATS = {
  patient: { prefix: "MRN", width: 6, yearly: false },
  employee: { prefix: "EMP", width: 4, yearly: false },
  appointment: { prefix: "APT", width: 6, yearly: true },
  encounter: { prefix: "ENC", width: 6, yearly: true },
  admission: { prefix: "ADM", width: 5, yearly: true },
  invoice: { prefix: "INV", width: 6, yearly: true },
  receipt: { prefix: "RCT", width: 6, yearly: true },
  prescription: { prefix: "RX", width: 6, yearly: true },
  labOrder: { prefix: "LAB", width: 6, yearly: true },
  specimen: { prefix: "SPC", width: 6, yearly: true },
  imaging: { prefix: "IMG", width: 5, yearly: true },
  emergency: { prefix: "ER", width: 5, yearly: true },
  procedure: { prefix: "PRC", width: 5, yearly: true },
  claim: { prefix: "CLM", width: 5, yearly: true },
  purchaseOrder: { prefix: "PO", width: 5, yearly: true },
};

export function newId(db, kind) {
  const f = ID_FORMATS[kind];
  if (!f) throw new Error(`Unknown identifier kind: ${kind}`);
  return nextIdentifier(db, kind, f.prefix, f.width, { yearly: f.yearly });
}
