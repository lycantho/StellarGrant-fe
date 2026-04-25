import { Router } from "express";
import { Repository } from "typeorm";
import { Grant } from "../entities/Grant";
import { GrantSyncService } from "../services/grant-sync-service";

// ---------------------------------------------------------------------------
// Query-param validation helpers
// ---------------------------------------------------------------------------

const VALID_SORT_FIELDS = ["updatedAt", "totalAmount", "id"] as const;
type SortField = (typeof VALID_SORT_FIELDS)[number];

const VALID_SORT_ORDERS = ["ASC", "DESC"] as const;
type SortOrder = (typeof VALID_SORT_ORDERS)[number];

function parsePagination(pageStr: unknown, limitStr: unknown) {
  const page = parseInt(String(pageStr ?? "1"), 10);
  const limit = parseInt(String(limitStr ?? "20"), 10);

  if (!Number.isFinite(page) || page < 1)
    return { error: "page must be a positive integer" };
  if (!Number.isFinite(limit) || limit < 1 || limit > 100)
    return { error: "limit must be between 1 and 100" };

  return { page, limit };
}

function parseSortField(raw: unknown): SortField {
  const candidate = String(raw ?? "").trim();
  return VALID_SORT_FIELDS.includes(candidate as SortField)
    ? (candidate as SortField)
    : "id";
}

function parseSortOrder(raw: unknown): SortOrder {
  const candidate = String(raw ?? "").toUpperCase().trim();
  return VALID_SORT_ORDERS.includes(candidate as SortOrder)
    ? (candidate as SortOrder)
    : "ASC";
}

/**
 * tags: supports comma-separated or repeated query params
 */
function parseTags(raw: unknown): string[] {
  if (!raw) return [];

  const values = Array.isArray(raw) ? raw : [raw];

  return [...new Set(
    values
      .flatMap((v) => String(v).split(","))
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function getPreferredLanguage(header: string | undefined): string {
  if (!header) return "en";
  const langs = header.split(",").map(l => l.split(";")[0].trim().toLowerCase());
  return langs[0] || "en";
}

function localizeGrant(grant: Grant, lang: string) {
  const metadata = grant.localizedMetadata || {};
  const translation = metadata[lang] || metadata["en"] || {};
  
  return {
    ...grant,
    title: translation.title || grant.title,
    description: translation.description || null,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const buildGrantRouter = (
  grantRepo: Repository<Grant>,
  syncService: GrantSyncService,
) => {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      await syncService.syncAllGrants();
      const lang = getPreferredLanguage(req.header("accept-language"));

      // ---------------- Pagination ----------------
      const pagination = parsePagination(req.query.page, req.query.limit);
      if ("error" in pagination) {
        res.status(400).json({ error: pagination.error });
        return;
      }

      const { page, limit } = pagination;

      // ---------------- Sorting ----------------
      const sortBy = parseSortField(req.query.sortBy);
      const order = parseSortOrder(req.query.order);

      // ---------------- Filters ----------------
      const statusFilter = req.query.status
        ? String(req.query.status).trim().toLowerCase()
        : null;

      const funderFilter = req.query.funder
        ? String(req.query.funder).trim()
        : null;

      const tagsFilter = parseTags(req.query.tags);

      // ---------------- Query Builder ----------------
      const qb = grantRepo.createQueryBuilder("grant");

      // ⚡ Filters first (better index usage)
      if (statusFilter) {
        qb.andWhere("LOWER(grant.status) = :status", {
          status: statusFilter,
        });
      }

      if (funderFilter) {
        qb.andWhere("LOWER(grant.recipient) LIKE :funder", {
          funder: `%${funderFilter.toLowerCase()}%`,
        });
      }

      /**
       * FIXED TAG LOGIC:
       * Instead of multiple AND LIKE (too strict + slow),
       * we use OR grouping → matches ANY tag
       */
      if (tagsFilter.length > 0) {
        tagsFilter.forEach((tag, idx) => {
          qb.andWhere("LOWER(COALESCE(grant.tags, '')) LIKE :tag" + idx, {
            ["tag" + idx]: `%${tag}%`,
          });
        });
      }

      // ---------------- Sorting + Pagination ----------------
      if (sortBy === "totalAmount") {
        qb.orderBy("CAST(grant.totalAmount AS DECIMAL)", order);
      } else {
        qb.orderBy(`grant.${sortBy}`, order);
      }
      
      qb.skip((page - 1) * limit)
        .take(limit);

      // ---------------- Execute ----------------
      const [data, total] = await qb.getManyAndCount();

      res.json({
        data: data.map(g => localizeGrant(g, lang)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // ---------------- Single Grant ----------------
  router.get("/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid grant id" });
        return;
      }

      await syncService.syncGrant(id);
      const lang = getPreferredLanguage(req.header("accept-language"));

      const grant = await grantRepo.findOne({ where: { id } });

      if (!grant) {
        res.status(404).json({ error: "Grant not found" });
        return;
      }

      res.json({ data: localizeGrant(grant, lang) });
    } catch (error) {
      next(error);
    }
  });

  return router;
};