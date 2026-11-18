import { useI18n } from "./i18n";
import type { TravelPlannerTask } from "../../tasks/types";
import TravelDataView from "./TravelDataView";

export default function TravelTaskPanel({ task }: { task: TravelPlannerTask }) {
  const { t } = useI18n();
  return (
    <aside className="task-panel travel-task-panel">
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <h3>{t("Travel request")}</h3>
      <p className="travel-query">{task.query}</p>
      <dl className="trip-details">
        {task.trip_details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        ))}
      </dl>
      <h3>{t("Travel data")}</h3>
      <p>{task.reference_notice}</p>
      <TravelDataView reference={task.reference_information} />
      <h3>{t("Planning rules")}</h3>
      <ul className="state-list planning-rules">
        {task.planning_rules.map((r) => (
          <li key={r.rule}>
            {r.rule}
            {r.details && (
              <ul>
                {r.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <h3>{t("Final itinerary")}</h3>
      <p>{task.final_instruction}</p>
      <details className="source">
        <summary>{t("Task source and adaptation")}</summary>
        <p>
          {t("TravelPlanner · ")}
          {task.source.split}
          {t(" · row ")}
          {task.source.row_index}{" "}
          {t(
            "(zero-based). The original request and all supplied travel options are retained. No reference itinerary is included.",
          )}
        </p>
        <p>
          {t(
            "This task uses the official sole-planning data in a human–AI chat study. It does not run the original tool environment or automatic benchmark evaluation.",
          )}
        </p>
        <p>{task.source.attribution}</p>
        <p>
          {t("Dataset: ")}
          {task.source.dataset}
          {t(". License: ")}
          {task.source.license}.
        </p>
      </details>
    </aside>
  );
}
