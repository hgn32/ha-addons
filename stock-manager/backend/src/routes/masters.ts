import { Router } from "express";
import { prisma } from "../db";

type Delegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<unknown>;
};

function crudRouter(path: string, delegate: Delegate, fields: string[]): Router {
  const r = Router();

  r.get(`/${path}`, async (_req, res) => {
    res.json(await delegate.findMany({ orderBy: [{ sort_order: "asc" }, { created_at: "asc" }] }));
  });

  r.post(`/${path}`, async (req, res) => {
    // Place new items at the end
    const existing = await delegate.findMany({ select: { id: true } });
    const data: Record<string, unknown> = { sort_order: existing.length };
    for (const f of fields) data[f] = String(req.body[f] ?? "").trim();
    res.status(201).json(await delegate.create({ data }));
  });

  r.put(`/${path}/reorder`, async (req, res) => {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids)) return res.status(400).json({ detail: "ids must be array" });
    await Promise.all(
      ids.map((id, index) => delegate.update({ where: { id }, data: { sort_order: index } }))
    );
    res.status(204).end();
  });

  r.put(`/${path}/:id`, async (req, res) => {
    const data: Record<string, string> = {};
    for (const f of fields) data[f] = String(req.body[f] ?? "").trim();
    try {
      res.json(await delegate.update({ where: { id: req.params.id }, data }));
    } catch {
      res.status(404).json({ detail: "Not found" });
    }
  });

  r.delete(`/${path}/:id`, async (req, res) => {
    try {
      await delegate.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch {
      res.status(404).json({ detail: "Not found" });
    }
  });

  return r;
}

const router = Router();
router.use(crudRouter("categories", prisma.category as unknown as Delegate, ["name", "note", "icon"]));
router.use(crudRouter("locations", prisma.location as unknown as Delegate, ["name", "note", "icon"]));
router.use(crudRouter("suppliers", prisma.supplier as unknown as Delegate, ["name", "url", "note"]));

export default router;
