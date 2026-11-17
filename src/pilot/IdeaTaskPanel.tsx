import { useI18n } from "./i18n";
import type { LiveIdeaTask } from "../../tasks/types";

/** The English keyword, with the UI-language gloss when one exists. */
export function KeywordName({ keyword }: { keyword: string }) {
  const { t } = useI18n();
  const gloss = t(keyword);
  return gloss === keyword ? (
    <>{keyword}</>
  ) : (
    <>
      {gloss} <span lang="en">({keyword})</span>
    </>
  );
}
export default function IdeaTaskPanel({ task }: { task: LiveIdeaTask }) {
  const { t } = useI18n();
  return (
    <aside className="task-panel idea-task-panel">
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <div className="goal idea-keyword">
        <div className="eyebrow">{t("Keyword")}</div>
        <strong>
          <KeywordName keyword={task.keyword} />
        </strong>
      </div>
      <h3>{t("What makes a good research idea")}</h3>
      <div className="action-list">
        {task.criteria.map((c) => (
          <div key={c.name}>
            <div>
              <strong>{c.label}</strong>
            </div>
            <p>{c.detail}</p>
          </div>
        ))}
      </div>
      <h3>{t("Final idea")}</h3>
      <p>{task.final_instruction}</p>
      <details className="source">
        <summary>{t("Task source and adaptation")}</summary>
        <p>
          {t(
            "Adapted from the LiveIdeaBench idea-generation prompt. The benchmark gives a model a single keyword; here you develop the idea yourself with an AI collaborator that can search the web. No scoring or feedback is applied.",
          )}
        </p>
        <pre>{task.original.idea_prompt}</pre>
        <p>{task.source.attribution}</p>
        <p>
          {t("License: {license}.", { license: task.source.license ?? "" })}
        </p>
      </details>
    </aside>
  );
}
