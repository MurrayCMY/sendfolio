import { api } from "../api";
import { t } from "../i18n";

export interface Bar {
  page: number;
  ms: number;
  note?: string;
}

/** Hand-written chart: x = page (with thumbnail), y = seconds. No chart library. */
export function BarChart({ versionId, bars, caption }: { versionId: string; bars: Bar[]; caption?: string }) {
  const max = Math.max(1000, ...bars.map((b) => b.ms));
  const secs = (ms: number) => (ms >= 10000 ? String(Math.round(ms / 1000)) : (ms / 1000).toFixed(1));
  return (
    <div class="chart">
      <div class="chart-axis">
        <span>{t("{0}s", Math.round(max / 1000))}</span>
        <span>0</span>
      </div>
      <div class="chart-scroll">
        <div class="bars">
          {bars.map((b) => (
            <div class="bar" key={b.page} title={t("Page {0}: {1} s", b.page, secs(b.ms))}>
              <div class="barval">{b.ms >= 500 ? secs(b.ms) : ""}</div>
              <div class="barcol"><div class="barfill" style={{ height: `${(b.ms / max) * 100}%` }} /></div>
              <img src={api.thumbUrl(versionId, b.page)} alt="" loading="lazy" />
              <span class="barpage">{b.page}</span>
              {b.note && <span class="barnote">{b.note}</span>}
            </div>
          ))}
        </div>
      </div>
      {caption && <p class="muted small">{caption}</p>}
    </div>
  );
}
