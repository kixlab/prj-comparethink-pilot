import type { TravelPlannerTask, TravelReference } from "../../tasks/types";

function ReferenceSection({
  title,
  data,
}: {
  title: string;
  data: TravelReference;
}) {
  const columns =
    typeof data === "string"
      ? []
      : [...new Set(data.flatMap((row) => Object.keys(row)))];
  return (
    <details className="travel-reference-section">
      <summary>
        {title}
        {Array.isArray(data) ? ` (${data.length})` : ""}
      </summary>
      {typeof data === "string" ? (
        <p>{data}</p>
      ) : data.length ? (
        <div
          className="reference-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${title} table`}
        >
          <table>
            <caption>{title}</caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
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
        <p>No options were supplied for this section.</p>
      )}
    </details>
  );
}
export default function TravelTaskPanel({ task }: { task: TravelPlannerTask }) {
  return (
    <aside className="task-panel travel-task-panel">
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <h3>Travel request</h3>
      <p className="travel-query">{task.query}</p>
      <dl className="trip-details">
        {task.trip_details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        ))}
      </dl>
      <h3>Travel data</h3>
      <p>{task.reference_notice}</p>
      <p className="table-help">
        Open a section to view its options. Tables scroll horizontally.
      </p>
      <div className="travel-references" aria-label="Provided travel data">
        {Object.entries(task.reference_information).map(([title, data]) => (
          <ReferenceSection key={title} title={title} data={data} />
        ))}
      </div>
      <h3>Final itinerary</h3>
      <p>{task.final_instruction}</p>
      <details className="source">
        <summary>Task source and adaptation</summary>
        <p>
          TravelPlanner · {task.source.split} · row {task.source.row_index}{" "}
          (zero-based). The original request and all supplied travel options are
          retained. No reference itinerary is included.
        </p>
        <p>
          This task uses the official sole-planning data in a human–AI chat
          study. It does not run the original tool environment or automatic
          benchmark evaluation.
        </p>
        <p>{task.source.attribution}</p>
        <p>
          Dataset: {task.source.dataset}. License: {task.source.license}.
        </p>
      </details>
    </aside>
  );
}
