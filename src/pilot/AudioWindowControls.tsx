import { useI18n } from "./i18n";
import type { ReviewWindow, WindowExchange } from "./reviewWindows";

const duration = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export default function AudioWindowControls({
  exchange,
  windows,
  selectedId,
  onSelect,
}: {
  exchange: WindowExchange;
  windows: ReviewWindow[];
  selectedId: string | null;
  onSelect: (window: ReviewWindow, requestId: string) => void;
}) {
  const { t } = useI18n();
  const choices = [
    {
      label: "Previous interval",
      key: exchange.before_window_id,
      aria: "previous",
    },
    { label: "Waiting", key: exchange.waiting_window_id, aria: "waiting" },
    {
      label: "Response appearing",
      key: exchange.response_window_id,
      aria: "response",
    },
    {
      label: "After response",
      key: exchange.after_window_id,
      aria: "after-response",
    },
  ];
  return (
    <div
      className="audio-window-controls"
      role="group"
      aria-label={t("Audio windows for exchange {number}", {
        number: exchange.turn_index,
      })}
    >
      {choices.map((choice) => {
        const window = windows.find((w) => w.window_id === choice.key);
        return (
          <button
            key={choice.aria}
            aria-label={t(`Play ${choice.aria} audio, exchange {number}`, {
              number: exchange.turn_index,
            })}
            data-window-id={window?.window_id}
            aria-pressed={Boolean(window && selectedId === window.window_id)}
            disabled={!window || window.duration_ms <= 0}
            title={
              window
                ? `${t(window.label)}${window.censored ? ` · ${t("Ending was not observed")}` : ""}`
                : choice.aria === "response"
                  ? t("No first-display interval was recorded")
                  : t("No bounded interval is available")
            }
            onClick={() => window && onSelect(window, exchange.request_id)}
          >
            <span>
              {choice.aria === "previous" &&
              window?.kind === "before_first_prompt"
                ? t("Before first prompt")
                : t(choice.label)}
            </span>
            <small>
              {window
                ? duration(window.duration_ms) +
                  (window.censored ? t(" · unfinished") : "")
                : t("Not recorded")}
            </small>
          </button>
        );
      })}
    </div>
  );
}
