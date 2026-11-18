import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";
import type { ReferenceCell, TravelReference } from "../../tasks/types";

// Display-only view of the TravelPlanner reference data. Values are formatted, never changed or
// filtered; the AI receives the original sections, and every original table stays available below.

type Row = Record<string, ReferenceCell>;
type Section = { title: string; data: TravelReference };
type TabId = "transport" | "stays" | "food" | "sights";

const num = (v: ReferenceCell) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};
const money = (v: ReferenceCell) => {
  const n = num(v);
  return n == null ? String(v ?? "—") : `$${n.toLocaleString("en-US")}`;
};
const kindOf = (title: string): TabId | "ground" | "flight" | null =>
  /^Flight from /.test(title)
    ? "flight"
    : /^(Self-driving|Taxi) from /.test(title)
      ? "ground"
      : /^Accommodations in /.test(title)
        ? "stays"
        : /^Restaurants in /.test(title)
          ? "food"
          : /^Attractions in /.test(title)
            ? "sights"
            : null;

function RawTable({ title, data }: Section) {
  const { t } = useI18n();
  const columns =
    typeof data === "string"
      ? []
      : [...new Set(data.flatMap((row) => Object.keys(row)))];
  return (
    <details className="travel-reference-section">
      <summary>
        {t(title)}
        {Array.isArray(data) ? ` (${data.length})` : ""}
      </summary>
      {typeof data === "string" ? (
        <p>{data}</p>
      ) : data.length ? (
        <div
          className="reference-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("{title} table", { title: t(title) })}
        >
          <table>
            <caption>{t(title)}</caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {t(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  {columns.map((column) => (
                    <td key={column}>
                      {row[column] == null ? "—" : String(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t("No options were supplied for this section.")}</p>
      )}
    </details>
  );
}

interface Column {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
  /** Present when the column can be sorted. */
  sort?: (row: Row) => number | string | null;
  numeric?: boolean;
}
function SortableTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: Column[];
  rows: Row[];
}) {
  const { t } = useI18n();
  const [order, setOrder] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === order?.key);
    if (!column?.sort || !order) return rows;
    const value = column.sort;
    return [...rows].sort((a, b) => {
      const x = value(a),
        y = value(b);
      if (x == null || y == null) return x == null ? 1 : -1; // blanks last
      return (x < y ? -1 : x > y ? 1 : 0) * order.dir;
    });
  }, [rows, columns, order]);
  return (
    <div
      className="reference-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={t("{title} table", { title: caption })}
    >
      <table className="travel-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = order?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? "num" : undefined}
                  aria-sort={
                    active
                      ? order.dir === 1
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {c.sort ? (
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() =>
                        setOrder(
                          active
                            ? { key: c.key, dir: order.dir === 1 ? -1 : 1 }
                            : { key: c.key, dir: 1 },
                        )
                      }
                    >
                      {c.label}
                      <span aria-hidden="true">
                        {active ? (order.dir === 1 ? " ▲" : " ▼") : " ↕"}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "num" : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const tags = (value: ReferenceCell, separator: RegExp) =>
  String(value ?? "")
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
function Tags({ items }: { items: string[] }) {
  return items.length ? (
    <span className="tag-list">
      {items.map((item) => (
        <span key={item} className="tag">
          {item}
        </span>
      ))}
    </span>
  ) : (
    <>—</>
  );
}

function useDuration() {
  const { t } = useI18n();
  return (text: string) => {
    const h = /(\d+)\s*hours?/.exec(text)?.[1];
    const m = /(\d+)\s*min(?:ute)?s?/.exec(text)?.[1];
    if (!h && !m) return text;
    return h && m
      ? t("{h} h {m} min", { h, m })
      : h
        ? t("{h} h", { h })
        : t("{m} min", { m: m ?? "0" });
  };
}

/** One table per route comparing every listed way to travel it. */
function TransportTab({ sections }: { sections: Section[] }) {
  const { t } = useI18n();
  const duration = useDuration();
  const routes = new Map<
    string,
    { from: string; to: string; date?: string; rows: Row[] }
  >();
  for (const { title, data } of sections) {
    const match =
      /^(Flight|Self-driving|Taxi) from (.+?) to (.+?)(?: on (\S+))?$/.exec(
        title,
      );
    if (!match) continue;
    const [, mode, from, to, date] = match;
    const key = `${from}→${to}`;
    const route = routes.get(key) ?? { from, to, rows: [] };
    if (date) route.date = date;
    routes.set(key, route);
    if (mode === "Flight" && Array.isArray(data))
      for (const f of data)
        route.rows.push({
          mode: "Flight",
          id: f["Flight Number"],
          times: `${f.DepTime ?? "?"} → ${f.ArrTime ?? "?"}`,
          duration: String(f.ActualElapsedTime ?? ""),
          distance: num(f.Distance) == null ? null : `${num(f.Distance)} mi`,
          cost: f.Price,
        });
    else if (typeof data === "string") {
      const g =
        /duration:\s*([^,]+),\s*distance:\s*([^,]+),\s*cost:\s*([\d.]+)/i.exec(
          data,
        );
      route.rows.push(
        g
          ? {
              mode,
              id: null,
              times: null,
              duration: g[1].trim(),
              distance: g[2].trim(),
              cost: g[3],
            }
          : {
              mode,
              id: null,
              times: null,
              duration: null,
              distance: null,
              cost: null,
              note: data,
            },
      );
    }
  }
  const columns: Column[] = [
    {
      key: "mode",
      label: t("Mode"),
      render: (r) => t(String(r.mode)),
      sort: (r) => t(String(r.mode)),
    },
    { key: "id", label: t("Flight Number"), render: (r) => r.id ?? "—" },
    {
      key: "times",
      label: t("Departs → arrives"),
      render: (r) => r.times ?? "—",
    },
    {
      key: "duration",
      label: t("Travel time"),
      render: (r) =>
        r.duration ? duration(String(r.duration)) : String(r.note ?? "—"),
    },
    { key: "distance", label: t("Distance"), render: (r) => r.distance ?? "—" },
    {
      key: "cost",
      label: t("Cost"),
      numeric: true,
      render: (r) => (r.cost == null ? "—" : money(r.cost)),
      sort: (r) => num(r.cost),
    },
  ];
  return (
    <>
      {[...routes.values()].map((route) => {
        const { from, to, date } = route;
        const caption = date
          ? t("{date} · {from} → {to}", { date, from, to })
          : t("{from} → {to}", { from, to });
        return (
          <section key={caption} className="travel-group">
            <h4>{caption}</h4>
            <SortableTable
              caption={caption}
              columns={columns}
              rows={route.rows}
            />
          </section>
        );
      })}
    </>
  );
}

function ListTab({
  sections,
  columns,
}: {
  sections: Section[];
  columns: Column[];
}) {
  const { t } = useI18n();
  return (
    <>
      {sections.map(({ title, data }) => {
        const caption = t(title);
        return (
          <section key={title} className="travel-group">
            <h4>
              {caption} ({Array.isArray(data) ? data.length : 0})
            </h4>
            {Array.isArray(data) && (
              <SortableTable caption={caption} columns={columns} rows={data} />
            )}
          </section>
        );
      })}
    </>
  );
}

export default function TravelDataView({
  reference,
}: {
  reference: Record<string, TravelReference>;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>("transport");
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!wide) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setWide(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [wide]);

  const sections = Object.entries(reference).map(([title, data]) => ({
    title,
    data,
  }));
  const byTab: Record<TabId, Section[]> = {
    transport: sections.filter((s) =>
      ["flight", "ground"].includes(kindOf(s.title) ?? ""),
    ),
    stays: sections.filter((s) => kindOf(s.title) === "stays"),
    food: sections.filter((s) => kindOf(s.title) === "food"),
    sights: sections.filter((s) => kindOf(s.title) === "sights"),
  };
  const other = sections.filter((s) => kindOf(s.title) == null);
  const tabs: { id: TabId; label: string }[] = [
    { id: "transport", label: t("Transportation") },
    { id: "stays", label: t("Accommodations") },
    { id: "food", label: t("Restaurants") },
    { id: "sights", label: t("Attractions") },
  ];

  const stayColumns: Column[] = [
    {
      key: "name",
      label: t("Name"),
      render: (r) => String(r.NAME ?? "—"),
      sort: (r) => String(r.NAME ?? ""),
    },
    {
      key: "price",
      label: t("Price per night"),
      numeric: true,
      render: (r) => money(r.price),
      sort: (r) => num(r.price),
    },
    {
      key: "type",
      label: t("room type"),
      render: (r) => String(r["room type"] ?? "—"),
      sort: (r) => String(r["room type"] ?? ""),
    },
    {
      key: "min",
      label: t("minimum nights"),
      numeric: true,
      render: (r) =>
        num(r["minimum nights"]) == null
          ? "—"
          : t("{n} nights", { n: num(r["minimum nights"])! }),
      sort: (r) => num(r["minimum nights"]),
    },
    {
      key: "max",
      label: t("maximum occupancy"),
      numeric: true,
      render: (r) =>
        num(r["maximum occupancy"]) == null
          ? "—"
          : t("{n} people", { n: num(r["maximum occupancy"])! }),
      sort: (r) => num(r["maximum occupancy"]),
    },
    {
      key: "rating",
      label: t("review rate number"),
      numeric: true,
      render: (r) =>
        num(r["review rate number"]) == null
          ? "—"
          : num(r["review rate number"])!.toFixed(1),
      sort: (r) => num(r["review rate number"]),
    },
    {
      key: "rules",
      label: t("house_rules"),
      render: (r) => <Tags items={tags(r.house_rules, /\s*&\s*/)} />,
    },
  ];
  const foodColumns: Column[] = [
    {
      key: "name",
      label: t("Name"),
      render: (r) => String(r.Name ?? "—"),
      sort: (r) => String(r.Name ?? ""),
    },
    {
      key: "cost",
      label: t("Average cost per person"),
      numeric: true,
      render: (r) => money(r["Average Cost"]),
      sort: (r) => num(r["Average Cost"]),
    },
    {
      key: "cuisines",
      label: t("Cuisines"),
      render: (r) => <Tags items={tags(r.Cuisines, /\s*,\s*/)} />,
    },
    {
      key: "rating",
      label: t("Aggregate Rating"),
      numeric: true,
      render: (r) =>
        num(r["Aggregate Rating"]) == null
          ? "—"
          : num(r["Aggregate Rating"])!.toFixed(1),
      sort: (r) => num(r["Aggregate Rating"]),
    },
  ];
  // Websites are deliberately not linked: the task is a closed benchmark scenario.
  const sightColumns: Column[] = [
    {
      key: "name",
      label: t("Name"),
      render: (r) => String(r.Name ?? "—"),
      sort: (r) => String(r.Name ?? ""),
    },
    {
      key: "address",
      label: t("Address"),
      render: (r) => String(r.Address ?? "—"),
    },
  ];

  const body =
    tab === "transport" ? (
      <TransportTab sections={byTab.transport} />
    ) : tab === "stays" ? (
      <ListTab sections={byTab.stays} columns={stayColumns} />
    ) : tab === "food" ? (
      <ListTab sections={byTab.food} columns={foodColumns} />
    ) : (
      <ListTab sections={byTab.sights} columns={sightColumns} />
    );

  const view = (
    <div
      className={`travel-data${wide ? " wide" : ""}`}
      role={wide ? "dialog" : undefined}
      aria-modal={wide ? true : undefined}
      aria-label={wide ? t("Travel data") : undefined}
    >
      <div className="travel-data-bar">
        <div role="tablist" aria-label={t("Provided travel data")}>
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`travel-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="travel-tab-panel"
              className={tab === id ? "active" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="secondary small"
          onClick={() => setWide(!wide)}
        >
          {wide ? t("Close wide view") : t("Wide view")}
        </button>
      </div>
      <p className="table-help">
        {t(
          "Click a column header to sort. Values are shown as supplied; the original tables are under “Original data”.",
        )}
      </p>
      <div
        role="tabpanel"
        id="travel-tab-panel"
        aria-labelledby={`travel-tab-${tab}`}
      >
        {body}
        <details className="travel-original">
          <summary>{t("Original data")}</summary>
          <div className="travel-references">
            {byTab[tab].map((s) => (
              <RawTable key={s.title} {...s} />
            ))}
          </div>
        </details>
      </div>
      {other.length > 0 && (
        <div className="travel-references">
          {other.map((s) => (
            <RawTable key={s.title} {...s} />
          ))}
        </div>
      )}
    </div>
  );
  return wide ? (
    <>
      <div className="travel-data-backdrop" onClick={() => setWide(false)} />
      {view}
    </>
  ) : (
    view
  );
}
