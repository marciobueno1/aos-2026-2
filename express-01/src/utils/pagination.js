/**
 * Limite máximo permitido para número de página, evitando overflow de OFFSET no PostgreSQL.
 */
export const MAX_PAGE = 1_000_000;

/**
 * Normaliza parâmetros de paginação e ordenação como camada de defesa em profundidade.
 *
 * @param {object} [params]
 * @param {number|string} [params.page=1]
 * @param {number|string} [params.limit=10]
 * @param {string} [params.order="DESC"]
 * @returns {{ page: number, limit: number, order: "ASC" | "DESC", offset: number }}
 */
export const normalizePaginationParams = ({
  page = 1,
  limit = 10,
  order = "DESC",
} = {}) => {
  const parsedPage = Number(page);
  const safePage =
    Number.isInteger(parsedPage) && parsedPage >= 1
      ? Math.min(MAX_PAGE, parsedPage)
      : 1;

  const parsedLimit = Number(limit);
  const safeLimit = Number.isInteger(parsedLimit)
    ? Math.min(100, Math.max(1, parsedLimit))
    : 10;

  const safeOrder =
    typeof order === "string" && order.toUpperCase() === "ASC" ? "ASC" : "DESC";

  return {
    page: safePage,
    limit: safeLimit,
    order: safeOrder,
    offset: (safePage - 1) * safeLimit,
  };
};

/**
 * Executa consulta paginada e determinística em um modelo Sequelize via findAndCountAll.
 *
 * @param {import("sequelize").ModelStatic<any>} model
 * @param {object} [params]
 * @returns {Promise<{ data: Array, meta: { total: number, page: number, limit: number, totalPages: number, order: "ASC" | "DESC" } }>}
 */
export const findPaginated = async (model, params = {}) => {
  const {
    page: safePage,
    limit: safeLimit,
    order: safeOrder,
    offset,
  } = normalizePaginationParams(params);

  const { rows, count } = await model.findAndCountAll({
    order: [
      ["createdAt", safeOrder],
      ["id", safeOrder],
    ],
    limit: safeLimit,
    offset,
  });

  return {
    data: rows,
    meta: {
      total: count,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(count / safeLimit)),
      order: safeOrder,
    },
  };
};

/**
 * Define cabeçalhos HTTP padronizados de paginação na resposta Express.
 *
 * @param {import("express").Response} res
 * @param {{ total: number, page: number, limit: number, totalPages: number }} meta
 */
export const setPaginationHeaders = (res, meta) => {
  if (typeof res?.set === "function" && meta) {
    res.set("X-Total-Count", String(meta.total));
    res.set("X-Page", String(meta.page));
    res.set("X-Limit", String(meta.limit));
    res.set("X-Total-Pages", String(meta.totalPages));
  }
};
