import { useEffect, useState, type ReactNode } from "react";
import { validAppearanceValue, type AppearanceKey, type ResolvedAppearance } from "../lib/appearanceSettings";
import { accentPalette } from "../lib/accent";
import type { PropertiesMode } from "../lib/editor/frontmatter";
import {
  EDITOR_MEASURE_SLIDER_MAX,
  EDITOR_MEASURE_SLIDER_MIN,
  EDITOR_MEASURE_STEP,
  measureLabel,
  measureToSlider,
  sliderToMeasure,
} from "../lib/editorMeasure";
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_STEP,
  PROPERTIES_MODES,
} from "../lib/prefs";
import type { ThemeMode } from "../lib/theme";
import { ContentWidthPreview } from "./ContentWidthPreview";
import { BarSlider } from "./kit/BarSlider";
import { SegmentedChips } from "./kit/SegmentedChips";
import { Switch } from "./Switch";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Accent seed palette data; the rendered accent is adjusted for readability.
const ACCENTS = [
  ["Ink", "ink"], ["Blue", "#3b74d1"], ["Teal", "#23877e"],
  ["Green", "#3f8850"], ["Amber", "#c98a12"], ["Coral", "#dc6e52"],
  ["Rose", "#d4567a"], ["Violet", "#7f73ff"],
] as const;

/**
 * The appearance rows, shared by Account Settings → Appearance (personal)
 * and Vault Settings → Appearance (defaults for everyone). Both pages render
 * the same controls with a concrete value on every row.
 *
 * personal: the EFFECTIVE values, plus `trailing(key)` (the "Vault default"
 *   tag or the "Reset to vault default" link).
 * vault: the vault's values (saved value, else the app default). The theme is
 *   saved through the same callback as the other vault defaults.
 *   `readOnly` disables every control.
 */
export function AppearanceRows(props: {
  mode: "personal" | "vault";
  /** What each control shows. */
  values: ResolvedAppearance;
  onChange: <K extends AppearanceKey>(key: K, value: ResolvedAppearance[K]) => void;
  readOnly?: boolean;
  trailing?: (key: AppearanceKey) => ReactNode;
}) {
  const { mode, values, onChange, readOnly = false, trailing } = props;
  const tail = (k: AppearanceKey) => trailing?.(k) ?? null;
  const [custom, setCustom] = useState(values.accent === "ink" ? "" : values.accent);
  useEffect(() => { setCustom(values.accent === "ink" ? "" : values.accent); }, [values.accent]);
  const invalidCustom = custom !== "" && (custom === "ink" || validAppearanceValue("accent", custom) === undefined);

  return (
    <>
      <div className="menu-row">
        <span className="menu-row-label">Theme</span>
        {tail("theme")}
        <SegmentedChips label="Theme" items={THEME_OPTIONS} value={values.theme}
          onChange={(value) => onChange("theme", value as ThemeMode)} disabled={readOnly} />
      </div>
      <div className="menu-row appearance-accent-row">
        <span className="menu-row-label">
          Accent
          {values.accent !== "ink" && accentPalette(values.accent).light.accent !== values.accent && (
            <span className="field-hint">Adjusted for readability</span>
          )}
        </span>
        {tail("accent")}
        <div role="group" aria-label="Accent presets" className="appearance-accent-presets">
          {ACCENTS.map(([name, value]) => (
            <button key={name} type="button" className="appearance-accent-swatch"
              title={name} aria-label={`Accent ${name}`} aria-pressed={values.accent === value}
              disabled={readOnly} style={{ width: 24, height: 24, background: value === "ink" ? "var(--text-primary)" : value }}
              onClick={() => onChange("accent", value)} />
          ))}
        </div>
        <div className="appearance-accent-custom">
          <label htmlFor={`accent-picker-${mode}`}>Custom</label>
          <input id={`accent-picker-${mode}`} type="color" aria-label="Custom accent color"
            style={{ width: 36, height: 32, padding: 4, flexShrink: 0 }}
            value={values.accent === "ink" ? ACCENTS[1][1] : values.accent} disabled={readOnly}
            onChange={(e) => onChange("accent", e.target.value as `#${string}`)} />
          <input aria-label="Custom accent hex" type="text" placeholder="#rrggbb" spellCheck={false}
            value={custom} disabled={readOnly} aria-invalid={invalidCustom}
            aria-describedby={invalidCustom ? `accent-error-${mode}` : undefined}
            style={{ width: "12ch", fontFamily: "var(--font-mono)", ...(invalidCustom ? { borderColor: "var(--danger)" } : {}) }}
            onChange={(e) => {
              setCustom(e.target.value);
              const value = validAppearanceValue("accent", e.target.value);
              if (value && value !== "ink") onChange("accent", value);
            }} />
          {invalidCustom && <span id={`accent-error-${mode}`} className="field-hint" role="status">Use #rrggbb.</span>}
        </div>
      </div>
      <label className="menu-row toggle-row">
        <span className="menu-row-label">
          Automatic file colors
          <span className="field-hint">
            Give every uncoloured file and folder a personal, stable colour.
          </span>
        </span>
        {tail("autoColors")}
        <Switch
          checked={values.autoColors}
          disabled={readOnly}
          ariaLabel="Automatic file colors"
          onChange={(next) => onChange("autoColors", next)}
        />
      </label>
      {/* The slider applies on every change rather than on release: the
          preview under it — and the note behind the card — are the answer to
          "how wide is that?", and they have to move with the thumb. */}
      <div className="menu-row measure-row">
        <span className="menu-row-label">
          Content width
          <span className="field-hint">
            How wide the text runs before it wraps. Drag to the end for the full window.
          </span>
        </span>
        {tail("contentWidth")}
        <div className="appearance-slider">
          <BarSlider label="Content width" min={EDITOR_MEASURE_SLIDER_MIN}
            max={EDITOR_MEASURE_SLIDER_MAX} step={EDITOR_MEASURE_STEP}
            value={measureToSlider(values.contentWidth)} disabled={readOnly}
            formatValue={(value) => measureLabel(sliderToMeasure(value))}
            onChange={(value) => onChange("contentWidth", sliderToMeasure(value))} />
        </div>
        <ContentWidthPreview measure={values.contentWidth} />
      </div>
      <div className="menu-row measure-row">
        <span className="menu-row-label">
          Text size
          <span className="field-hint">The size of note text in the editor.</span>
        </span>
        {tail("textSize")}
        <div className="appearance-slider">
          <BarSlider label="Text size" min={EDITOR_FONT_SIZE_MIN} max={EDITOR_FONT_SIZE_MAX}
            step={EDITOR_FONT_SIZE_STEP} value={values.textSize} disabled={readOnly}
            formatValue={(value) => `${value}px`} onChange={(value) => onChange("textSize", value)} />
        </div>
      </div>
      <label className="menu-row toggle-row">
        <span className="menu-row-label">
          Line numbers
          <span className="field-hint">Show a line-number gutter in the editor.</span>
        </span>
        {tail("lineNumbers")}
        <Switch
          checked={values.lineNumbers}
          disabled={readOnly}
          ariaLabel="Line numbers"
          onChange={(next) => onChange("lineNumbers", next)}
        />
      </label>
      {/* How the editor draws, so device-local unless a vault sets a default. */}
      <div className="menu-row">
        <span className="menu-row-label">
          Properties in document
          <span className="field-hint">
            How a note's YAML frontmatter is shown at the top of the note.
          </span>
        </span>
        {tail("properties")}
        <SegmentedChips label="Properties in document" size="sm" value={values.properties}
          items={PROPERTIES_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
          onChange={(value) => onChange("properties", value as PropertiesMode)} disabled={readOnly} />
      </div>
    </>
  );
}
