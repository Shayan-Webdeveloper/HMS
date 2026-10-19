import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, badRequest, forbidden } from "@/lib/errors";
import { can } from "@/lib/auth/session";
import { pageMeta } from "@/lib/validation/common";
import { dayRangeUtc, todayInTz, zonedToUtc } from "@/lib/utils/time";
import { toMoneyString } from "@/lib/utils/money";
import { patientSearchWhere } from "@/lib/services/patients";
import { notifyPermission, notifyUser } from "@/lib/services/notifications";
import { getHospital } from "@/lib/services/settings";
import { assertOrderablePatient } from "@/lib/services/lab";
import { putFile, sniffType, safeFilename, MAX_BYTES, ALLOWED_TYPES } from "@/lib/storage";
import { IMAGING_STATUSES, IMAGING_ACTIVE_STATUSES, IMAGING_STATUS_LABELS, MODALITIES, canTransitionImaging, catalogItemSchema } from "@/lib/validation/radiology";

const ci = (v) => ({ contains: v, mode: "insensitive" });
const CATALOG_KEY = "imaging.catalog";
const statusLabel = (s) => IMAGING_STATUS_LABELS[s] || s;
const link = (id) => `/radiology/${id}`;

// ═════════════════════════ Catalogue (SystemSetting "imaging.catalog") ═════════════════════════

async function readCatalogSetting() {
  const h = await getHospital();
  if (!h.id) return { hospitalId: null, value: { items: [] } };
  const row = await prisma.systemSetting.findUnique({ where: { hospitalId_key: { hospitalId: h.id, key: CATALOG_KEY } } });
  return { hospitalId: h.id, value: row?.value && typeof row.value === "object" ? row.value : { items: [] }, updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
}

/** Contract for GET /api/radiology/catalog: [{ code, modality, bodyPart, price }]. Malformed entries are skipped. */
export async function getImagingCatalog() {
  const { value } = await readCatalogSetting();
  const items = Array.isArray(value.items) ? value.items : [];
  const out = [];
  for (const raw of items) {
    const p = catalogItemSchema.safeParse({ ...raw, price: raw?.price != null ? String(raw.price) : raw?.price });
    if (p.success) out.push({ code: p.data.code, modality: p.data.modality, bodyPart: p.data.bodyPart, price: toMoneyString(p.data.price) });
  }
  return out;
}

export async function getImagingCatalogMeta() {
  const s = await readCatalogSetting();
  const by = s.updatedById ? await prisma.user.findUnique({ where: { id: s.updatedById }, select: { name: true } }) : null;
  return { updatedAt: s.updatedAt, updatedByName: by?.name ?? null };
}

export async function saveImagingCatalog({ items }, session, ip) {
  const s = await readCatalogSetting();
  if (!s.hospitalId) throw invalidState("The hospital profile is not configured.");
  const before = new Map((Array.isArray(s.value.items) ? s.value.items : []).map((i) => [String(i.code).toUpperCase(), i]));
  const clean = items.map((i) => ({ code: i.code, modality: i.modality, bodyPart: i.bodyPart, price: toMoneyString(i.price) }));
  const after = new Map(clean.map((i) => [i.code, i]));
  const added = clean.filter((i) => !before.has(i.code)).map((i) => i.code);
  const removed = [...before.keys()].filter((c) => !after.has(c));
  const changed = clean.filter((i) => {
    const b = before.get(i.code);
    return b && (b.modality !== i.modality || b.bodyPart !== i.bodyPart || toMoneyString(b.price ?? 0) !== i.price);
  }).map((i) => i.code);
  const value = { ...s.value, items: clean };
  return prisma.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { hospitalId_key: { hospitalId: s.hospitalId, key: CATALOG_KEY } },
      create: { hospitalId: s.hospitalId, key: CATALOG_KEY, value, updatedById: session.user.id },
      update: { value, updatedById: session.user.id },
    });
    await audit({ userId: session.user.id, action: "imaging.catalog.update", entityType: "SystemSetting", entityId: CATALOG_KEY, metadata: { itemCount: clean.length, added, removed, changed }, ipAddress: ip }, tx);
    return clean;
  });
}

// ═════════════════════════ Requests ═════════════════════════

export async function createImagingStudy(input, session, ip) {
  await assertOrderablePatient(prisma, input.patientId, input.encounterId);
  const catalog = await getImagingCatalog();
  const item = catalog.find((c) => c.code === input.catalogCode.toUpperCase());
  if (!item) throw invalidState("The selected examination is not in the imaging catalogue.");
  return prisma.$transaction(async (tx) => {
    const studyNo = await newId(tx, "imaging");
    const s = await tx.imagingStudy.create({
      data: {
        studyNo,
        patientId: input.patientId,
        encounterId: input.encounterId ?? null,
        requestedById: session.user.id,
        modality: item.modality,
        bodyPart: item.bodyPart,
        indication: input.indication ?? null,
        price: item.price, // snapshotted from the catalogue at request time
      },
    });
    await audit({ userId: session.user.id, action: "imaging.study.create", entityType: "ImagingStudy", entityId: s.id, metadata: { studyNo, catalogCode: item.code, modality: item.modality, patientId: input.patientId, encounterId: input.encounterId ?? null }, ipAddress: ip }, tx);
    await notifyPermission(["radiology:report"], { category: "RADIOLOGY", title: "New imaging request", body: `Study ${studyNo} (${item.modality}) is awaiting scheduling.`, link: link(s.id) }, tx);
    return { id: s.id, studyNo: s.studyNo, status: s.status, modality: s.modality, bodyPart: s.bodyPart, price: s.price, patientId: s.patientId, encounterId: s.encounterId, createdAt: s.createdAt };
  });
}

// ═════════════════════════ Worklist ═════════════════════════

export function imagingWhere({ q, status, modality, from, to, patientId, encounterId }, tz) {
  const and = [];
  if (patientId) and.push({ patientId });
  if (encounterId) and.push({ encounterId });
  const st = status || "ACTIVE";
  if (st === "ACTIVE") and.push({ status: { in: IMAGING_ACTIVE_STATUSES } });
  else if (IMAGING_STATUSES.includes(st)) and.push({ status: st });
  if (modality) and.push({ modality });
  if (from || to) {
    const createdAt = {};
    if (from) createdAt.gte = dayRangeUtc(from, tz)[0];
    if (to) createdAt.lt = dayRangeUtc(to, tz)[1];
    and.push({ createdAt });
  }
  if (q) and.push({ OR: [{ studyNo: ci(q) }, { bodyPart: ci(q) }, { patient: patientSearchWhere(q) }] });
  return and.length ? { AND: and } : {};
}

const SORT = { studyNo: "studyNo", createdAt: "createdAt", scheduledAt: "scheduledAt", modality: "modality" };

export async function listImagingStudies(query, tz) {
  const where = imagingWhere(query, tz);
  const { page, pageSize } = query;
  const sort = SORT[query.sort] || "createdAt";
  const dir = query.dir || "desc";
  const orderBy = sort === "scheduledAt" ? [{ scheduledAt: { sort: dir, nulls: "last" } }, { createdAt: "asc" }] : [{ [sort]: dir }, { id: dir }];
  const [total, rows] = await Promise.all([
    prisma.imagingStudy.count({ where }),
    prisma.imagingStudy.findMany({
      where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
      include: { patient: { select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true } } },
    }),
  ]);
  const reqIds = [...new Set(rows.map((r) => r.requestedById))];
  const users = reqIds.length ? await prisma.user.findMany({ where: { id: { in: reqIds } }, select: { id: true, name: true } }) : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return { rows: rows.map((r) => ({ ...r, requestedByName: names[r.requestedById] ?? null })), meta: pageMeta(total, page, pageSize) };
}

export async function imagingWorklistCounts(tz) {
  const [start, end] = dayRangeUtc(todayInTz(tz), tz);
  const [byStatus, scheduledToday, verifiedToday] = await Promise.all([
    prisma.imagingStudy.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.imagingStudy.count({ where: { status: "SCHEDULED", scheduledAt: { gte: start, lt: end } } }),
    prisma.imagingStudy.count({ where: { status: "VERIFIED", report: { verifiedAt: { gte: start, lt: end } } } }),
  ]);
  const status = Object.fromEntries(IMAGING_STATUSES.map((s) => [s, 0]));
  for (const r of byStatus) status[r.status] = r._count._all;
  const active = IMAGING_ACTIVE_STATUSES.reduce((a, s) => a + status[s], 0);
  const all = Object.values(status).reduce((a, b) => a + b, 0);
  return { status, active, all, scheduledToday, verifiedToday };
}

export async function imagingModalitiesInUse() {
  const rows = await prisma.imagingStudy.findMany({ distinct: ["modality"], select: { modality: true }, orderBy: { modality: "asc" } });
  return [...new Set([...MODALITIES, ...rows.map((r) => r.modality)])];
}

// ═════════════════════════ Detail ═════════════════════════

export async function getImagingStudy(id) {
  const s = await prisma.imagingStudy.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, phone: true, bloodGroup: true, medicalAlerts: true, status: true } },
      encounter: { select: { id: true, encounterNo: true, status: true, startedAt: true, type: true } },
      report: true,
    },
  });
  if (!s) return null;
  const ids = new Set([s.requestedById, s.report?.reportedById, s.report?.verifiedById].filter(Boolean));
  const [users, attachments, cancel] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }),
    listImagingAttachments(id),
    s.status === "CANCELLED"
      ? prisma.auditLog.findFirst({ where: { entityType: "ImagingStudy", entityId: id, action: "imaging.study.cancel" }, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } })
      : null,
  ]);
  s.userNames = Object.fromEntries(users.map((u) => [u.id, u.name]));
  s.attachments = attachments;
  s.cancellation = cancel ? { reason: cancel.metadata?.reason ?? null, at: cancel.createdAt, by: cancel.user?.name ?? null } : null;
  return s;
}

export async function getImagingActivity(id) {
  return prisma.auditLog.findMany({
    where: { entityType: "ImagingStudy", entityId: id, NOT: { action: { endsWith: ".view" } } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { user: { select: { name: true } } },
  });
}

/** Clinical report text is only shown to non-radiology readers once verified. */
export function redactImagingStudy(study, canSeeDraft) {
  if (canSeeDraft || study.status === "VERIFIED" || !study.report) return study;
  return { ...study, report: null, reportPendingVerification: true };
}

// ═════════════════════════ Workflow ═════════════════════════

function assertTransition(from, to, message) {
  if (!canTransitionImaging(from, to)) throw invalidState(message || `This study is ${statusLabel(from).toLowerCase()} and cannot move to "${statusLabel(to).toLowerCase()}".`);
}

async function moveStatus(tx, id, from, to, data = {}) {
  assertTransition(from, to);
  const r = await tx.imagingStudy.updateMany({ where: { id, status: from }, data: { status: to, ...data } });
  if (r.count === 0) throw conflict("This study was updated by someone else. Refresh and try again.");
}

async function loadStudy(id, include) {
  const s = await prisma.imagingStudy.findUnique({ where: { id }, include });
  if (!s) throw notFound("Imaging study not found");
  return s;
}

export async function scheduleStudy(id, { date, time }, session, ip, tz) {
  const s = await loadStudy(id);
  assertTransition(s.status, "SCHEDULED", "Only requested or scheduled studies can be (re)scheduled.");
  const at = zonedToUtc(date, time, tz);
  if (at.getTime() < Date.now() - 15 * 60 * 1000) throw invalidState("The appointment time is in the past.");
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, s.status, "SCHEDULED", { scheduledAt: at });
    await audit({ userId: session.user.id, action: s.status === "SCHEDULED" ? "imaging.study.reschedule" : "imaging.study.schedule", entityType: "ImagingStudy", entityId: id, metadata: { studyNo: s.studyNo, scheduledAt: at.toISOString(), previous: s.scheduledAt?.toISOString() ?? null }, ipAddress: ip }, tx);
    return { status: "SCHEDULED", scheduledAt: at };
  });
}

export async function startStudy(id, session, ip) {
  const s = await loadStudy(id);
  assertTransition(s.status, "IN_PROGRESS");
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, s.status, "IN_PROGRESS");
    await audit({ userId: session.user.id, action: "imaging.study.start", entityType: "ImagingStudy", entityId: id, metadata: { studyNo: s.studyNo, from: s.status }, ipAddress: ip }, tx);
    return { status: "IN_PROGRESS" };
  });
}

/** IN_PROGRESS → REPORTED creates the report; REPORTED → REPORTED edits it before verification. */
export async function saveReport(id, { findings, impression }, session, ip) {
  const s = await loadStudy(id, { report: true });
  assertTransition(s.status, "REPORTED", s.status === "VERIFIED" ? "Verified reports cannot be edited." : "Start the study before entering a report.");
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, s.status, "REPORTED");
    const now = new Date();
    if (s.report) {
      await tx.imagingReport.update({ where: { studyId: id }, data: { findings, impression, reportedById: session.user.id, reportedAt: now } });
    } else {
      await tx.imagingReport.create({ data: { studyId: id, findings, impression, reportedById: session.user.id, reportedAt: now } });
    }
    await audit({ userId: session.user.id, action: s.report ? "imaging.report.update" : "imaging.report.create", entityType: "ImagingStudy", entityId: id, metadata: { studyNo: s.studyNo, fields: ["findings", "impression"] }, ipAddress: ip }, tx);
    if (!s.report) await notifyPermission(["radiology:verify"], { category: "RADIOLOGY", title: "Imaging report awaiting verification", body: `Study ${s.studyNo}`, link: link(id) }, tx);
    return { status: "REPORTED" };
  });
}

export async function verifyReport(id, session, ip) {
  const s = await loadStudy(id, { report: true, patient: { select: { userLink: { select: { userId: true, verifiedAt: true } } } } });
  assertTransition(s.status, "VERIFIED", s.status === "VERIFIED" ? "This report is already verified." : "Only reported studies can be verified.");
  if (!s.report) throw invalidState("There is no report to verify.");
  const now = new Date();
  const selfVerification = s.report.reportedById === session.user.id;
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, "REPORTED", "VERIFIED");
    await tx.imagingReport.update({ where: { studyId: id }, data: { verifiedById: session.user.id, verifiedAt: now } });
    await audit({ userId: session.user.id, action: "imaging.report.verify", entityType: "ImagingStudy", entityId: id, metadata: { studyNo: s.studyNo, reportId: s.report.id, selfVerification }, ipAddress: ip }, tx);
    if (s.requestedById !== session.user.id) {
      await notifyUser(s.requestedById, { category: "RADIOLOGY", title: "Imaging report available", body: `Study ${s.studyNo}`, link: link(id) }, tx);
    }
    const portal = s.patient?.userLink;
    if (portal?.verifiedAt) {
      await notifyUser(portal.userId, { category: "RADIOLOGY", title: "New imaging report available", body: "An imaging report has been added to your record.", link: "/portal" }, tx);
    }
    return { status: "VERIFIED", verifiedAt: now, selfVerification };
  });
}

export async function cancelStudy(id, { reason }, session, ip) {
  const s = await loadStudy(id);
  const canCancel = can(session, ["radiology:report", "radiology:verify"]) || s.requestedById === session.user.id;
  if (!canCancel) throw forbidden("Only the requesting clinician or radiology staff can cancel this study.");
  assertTransition(s.status, "CANCELLED", "Reported or verified studies cannot be cancelled.");
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, s.status, "CANCELLED");
    // ImagingStudy has no cancel-reason column: the reason is kept in the audit trail.
    await audit({ userId: session.user.id, action: "imaging.study.cancel", entityType: "ImagingStudy", entityId: id, metadata: { studyNo: s.studyNo, from: s.status, reason }, ipAddress: ip }, tx);
    if (s.requestedById !== session.user.id) await notifyUser(s.requestedById, { category: "RADIOLOGY", title: "Imaging request cancelled", body: `Study ${s.studyNo}`, link: link(id) }, tx);
    return { status: "CANCELLED" };
  });
}

// ═════════════════════════ Attachments ═════════════════════════

export async function listImagingAttachments(studyId) {
  return prisma.uploadedDocument.findMany({
    where: { ownerType: "IMAGING", ownerId: studyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, category: true, createdAt: true, uploadedById: true },
  });
}

export async function addImagingAttachment(studyId, file, session, ip) {
  const s = await loadStudy(studyId);
  if (s.status === "CANCELLED") throw invalidState("Files cannot be attached to a cancelled study.");
  if (!file || typeof file === "string") throw badRequest("Choose a file to upload.");
  if (file.size > MAX_BYTES) throw badRequest(`File is too large (max ${(MAX_BYTES / 1048576).toFixed(0)} MB).`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) throw badRequest("The file is empty.");
  if (buf.length > MAX_BYTES) throw badRequest(`File is too large (max ${(MAX_BYTES / 1048576).toFixed(0)} MB).`);
  // Content must match an allowed type regardless of declared MIME type or extension.
  const sniffed = sniffType(buf);
  if (!sniffed || !ALLOWED_TYPES[sniffed]) throw badRequest("Only PDF, PNG and JPEG files are accepted.");
  const { key, sha256 } = await putFile(buf, sniffed);
  return prisma.$transaction(async (tx) => {
    const doc = await tx.uploadedDocument.create({
      data: { patientId: s.patientId, ownerType: "IMAGING", ownerId: studyId, category: "IMAGING_REPORT", originalName: safeFilename(file.name), storageKey: key, mimeType: sniffed, sizeBytes: buf.length, sha256, uploadedById: session.user.id },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, category: true, createdAt: true },
    });
    await audit({ userId: session.user.id, action: "imaging.attachment.upload", entityType: "ImagingStudy", entityId: studyId, metadata: { studyNo: s.studyNo, documentId: doc.id, mimeType: sniffed, sizeBytes: buf.length }, ipAddress: ip }, tx);
    return doc;
  });
}
