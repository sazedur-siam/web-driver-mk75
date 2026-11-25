import { ALERT_LEVELS, type Battery } from './battery';

/** Outlined battery whose bar fills with the level: theme --ok, or --danger once below the first alert level. */
export function BatteryIcon({ battery, size = 1 }: { battery: Battery; size?: number }) {
  const low = battery.level < ALERT_LEVELS[0] && !battery.charging;
  return (
    <span className={`batt${low ? ' low' : ''}`} style={{ fontSize: `${size}em` }} role="img" aria-label={`Keyboard battery ${battery.level}%${battery.charging ? ', charging' : ''}`}>
      <span className="batt-body">
        <span className="batt-fill" style={{ width: `${Math.max(battery.level, 4)}%` }} />
      </span>
      <b>
        {battery.charging && '⚡'}
        {battery.level}%
      </b>
    </span>
  );
}
