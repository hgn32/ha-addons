import { Router } from "express";
import { prisma } from "../db";

// Prisma model delegates expose the same find/create/update/delete shape, so a
// single factory covers all three simple master tables.
type Delegate = {
  findMany: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
};

function crudRouter(path: string, delegate: Delegate, fields: string[]): Router {
  const r = Router();

  r.get(`/${path}`, async (_req, res) => {
    res.json(await delegate.findMany({ orderBy: { created_at: "asc" } }));
  });

  r.post(`/${path}`, async (req, res) => {
    const data: Record<string, string> = {};
    for (const f of fields) data[f] = req.body[f] ?? "";
    res.status(201).json(await delegate.create({ data }));
  });

  r.put(`/${path}/:id`, async (req, res) => {
    const data: Record<string, string> = {};
    for (const f of fields) data[f] = req.body[f] ?? "";
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
router.use(crudRouter("categories", prisma.category as unknown as Delegate, ["name", "note"]));
router.use(crudRouter("locations", prisma.location as unknown as Delegate, ["name", "description"]));
router.use(crudRouter("suppliers", prisma.supplier as unknown as Delegate, ["name", "url", "note"]));

export default router;
