import { useState, useEffect, useRef, useCallback } from "react";

// ─── Utility ────────────────────────────────────────────────────────────────
function fmt(v, decimals = 1) {
  return isNaN(v) ? "—" : Number(v).toFixed(decimals);
}

function parseReading(data) {
  return {
    temperature: parseFloat(data.temperature ?? data.temp ?? NaN),
    humidity: parseFloat(data.humidity ?? data.hum ?? NaN),
    lat: parseFloat(data.lat ?? data.latitude ?? NaN),
    lon: parseFloat(data.lon ?? data.longitude ?? NaN),
    alt: parseFloat(data.alt ?? data.altitude ?? NaN),
  };
}

function timeLabel() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (_) {}
}

const MOCK_DATA = [
  { temperature: 22.4, humidity: 58, lat: 55.6761, lon: 12.5683, alt: 12 },
  { temperature: 23.1, humidity: 60, lat: 55.6761, lon: 12.5683, alt: 12 },
  { temperature: 25.8, humidity: 63, lat: 55.6761, lon: 12.5683, alt: 12 },
  { temperature: 29.3, humidity: 71, lat: 55.6761, lon: 12.5683, alt: 12 },
  { temperature: 27.0, humidity: 68, lat: 55.6761, lon: 12.5683, alt: 12 },
  { temperature: 21.5, humidity: 55, lat: 55.6761, lon: 12.5683, alt: 12 },
];

const MAX_HISTORY = 500;

// ─── Storage ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = "sigfox_readings";

function loadStoredHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveHistory(history) {
  try {
    const trimmed = history.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (_) {}
}

function exportJSON(history) {
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sigfox_readings_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(history) {
  const header = "timestamp,temperature,humidity,lat,lon,alt";
  const rows = history.map((r) =>
      [r.label, r.temperature, r.humidity, r.lat, r.lon, r.alt].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sigfox_readings_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function MetricCard({ label, value, unit, status }) {
  const statusColors = {
    ok: { bg: "#e8f5e0", text: "#2d6a1a", label: "Normal" },
    high: { bg: "#fde8e8", text: "#a32d2d", label: "Too high" },
    low: { bg: "#fff3cd", text: "#856404", label: "Too low" },
    none: null,
  };
  const s = statusColors[status];

  return (
      <div style={styles.metricCard}>
        <div style={styles.metricLabel}>{label}</div>
        <div style={styles.metricValueRow}>
          <span style={styles.metricValue}>{value}</span>
          {unit && <span style={styles.metricUnit}>{unit}</span>}
        </div>
        {s && (
            <span style={{ ...styles.badge, background: s.bg, color: s.text }}>
          {s.label}
        </span>
        )}
      </div>
  );
}

function AlertBanner({ alerts }) {
  if (!alerts.length) return null;
  return (
      <div style={styles.alertsWrap}>
        {alerts.map((a, i) => (
            <div
                key={i}
                style={{
                  ...styles.alertBanner,
                  background: a.type === "danger" ? "#fde8e8" : "#fff8e1",
                  borderColor: a.type === "danger" ? "#f5a0a0" : "#ffe082",
                  color: a.type === "danger" ? "#a32d2d" : "#7a5200",
                }}
            >
              <span style={{ fontSize: 16 }}>{a.type === "danger" ? "⚠" : "!"}</span>
              {a.msg}
            </div>
        ))}
      </div>
  );
}

function MiniChart({ history }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !window.Chart) return;
    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new window.Chart(canvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: history.map((h) => h.label),
        datasets: [
          {
            label: "Temp °C",
            data: history.map((h) => h.temperature),
            borderColor: "#c0392b",
            backgroundColor: "rgba(192,57,43,0.07)",
            tension: 0.35,
            pointRadius: 2,
            borderWidth: 2,
            yAxisID: "yTemp",
          },
          {
            label: "Humidity %",
            data: history.map((h) => h.humidity),
            borderColor: "#2980b9",
            backgroundColor: "rgba(41,128,185,0.07)",
            tension: 0.35,
            pointRadius: 2,
            borderDash: [5, 3],
            borderWidth: 2,
            yAxisID: "yHum",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { font: { size: 10, family: "'DM Mono', monospace" }, maxRotation: 45, autoSkip: true, color: "#999" },
            grid: { color: "rgba(0,0,0,0.05)" },
          },
          yTemp: {
            position: "left",
            ticks: { font: { size: 10, family: "'DM Mono', monospace" }, callback: (v) => v.toFixed(1) + "°", color: "#c0392b" },
            grid: { color: "rgba(0,0,0,0.05)" },
          },
          yHum: {
            position: "right",
            ticks: { font: { size: 10, family: "'DM Mono', monospace" }, callback: (v) => v.toFixed(0) + "%", color: "#2980b9" },
            grid: { display: false },
          },
        },
      },
    });
    return () => { chartRef.current?.destroy(); };
  }, [history]);

  return (
      <div style={{ position: "relative", width: "100%", height: 200 }}>
        <canvas
            ref={canvasRef}
            role="img"
            aria-label="Line chart of temperature and humidity over time"
        >
          Historical sensor readings.
        </canvas>
      </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function SigfoxDashboard() {
  const [apiUrl, setApiUrl] = useState("");
  const [pollInterval, setPollInterval] = useState(30);
  const [thresholds, setThresholds] = useState({ maxTemp: 28, minTemp: 15, maxHum: 70 });
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState(() => loadStoredHistory());
  const [chartLimit, setChartLimit] = useState(24);
  const [status, setStatus] = useState("idle");
  const [pollMsg, setPollMsg] = useState("Not connected");
  const [lastSeen, setLastSeen] = useState(null);
  const [notifPerm, setNotifPerm] = useState("default");
  const [alerts, setAlerts] = useState([]);
  const [chartReady, setChartReady] = useState(false);
  const pollRef = useRef(null);
  const alertedRef = useRef({});

  // Load Chart.js once
  useEffect(() => {
    if (window.Chart) { setChartReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
    s.onload = () => setChartReady(true);
    document.head.appendChild(s);
  }, []);

  // Restore latest reading from stored history on first load
  useEffect(() => {
    const stored = loadStoredHistory();
    if (stored.length > 0) {
      const last = stored[stored.length - 1];
      setLatest(last);
      setLastSeen(last.label);
    }
  }, []);

  const processReading = useCallback((raw) => {
    const reading = parseReading(raw);
    const label = timeLabel();
    reading.label = label;

    setLatest(reading);
    setLastSeen(label);
    setHistory((prev) => {
      const next = [...prev, reading];
      const trimmed = next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      saveHistory(trimmed);
      return trimmed;
    });

    // Check thresholds
    const newAlerts = [];
    if (!isNaN(reading.temperature)) {
      if (reading.temperature > thresholds.maxTemp)
        newAlerts.push({ msg: `Temperature too high: ${fmt(reading.temperature)}°C (max ${thresholds.maxTemp}°C)`, type: "danger" });
      else if (reading.temperature < thresholds.minTemp)
        newAlerts.push({ msg: `Temperature too low: ${fmt(reading.temperature)}°C (min ${thresholds.minTemp}°C)`, type: "warning" });
    }
    if (!isNaN(reading.humidity) && reading.humidity > thresholds.maxHum)
      newAlerts.push({ msg: `Humidity too high: ${fmt(reading.humidity, 0)}% (max ${thresholds.maxHum}%)`, type: "warning" });

    setAlerts(newAlerts);

    if (newAlerts.length) {
      playBeep();
      const key = newAlerts.map((a) => a.msg).join("|");
      if (notifPerm === "granted" && !alertedRef.current[key]) {
        new Notification("Sigfox sensor alert", { body: newAlerts[0].msg });
        alertedRef.current[key] = true;
        setTimeout(() => { delete alertedRef.current[key]; }, 60000);
      }
    } else {
      alertedRef.current = {};
    }
  }, [thresholds, notifPerm]);

  const clearHistory = () => {
    if (!window.confirm("Clear all stored readings? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
    setLatest(null);
    setLastSeen(null);
    setAlerts([]);
  };

  const fetchOnce = useCallback(async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      processReading(data);
      setStatus("polling");
      setPollMsg(`Connected — polling every ${pollInterval}s`);
    } catch (e) {
      setStatus("error");
      setPollMsg(`Error: ${e.message}`);
    }
  }, [processReading, pollInterval]);

  const startPolling = () => {
    if (!apiUrl.trim()) { setPollMsg("Please enter an API URL."); return; }
    stopPolling();
    setStatus("polling");
    fetchOnce(apiUrl);
    pollRef.current = setInterval(() => fetchOnce(apiUrl), Math.max(5, pollInterval) * 1000);
  };

  const stopPolling = () => {
    clearInterval(pollRef.current);
    setStatus("idle");
    setPollMsg("Stopped.");
  };

  const loadDemo = () => {
    stopPolling();
    setStatus("demo");
    setPollMsg("Demo mode — showing sample data");
    setHistory([]);
    setLatest(null);
    let i = 0;
    const tick = () => {
      if (i < MOCK_DATA.length) { processReading(MOCK_DATA[i++]); setTimeout(tick, 700); }
    };
    tick();
  };

  const requestNotif = () => {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(setNotifPerm);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  // Derive temp/hum status
  const tempStatus = !latest || isNaN(latest.temperature)
      ? "none"
      : latest.temperature > thresholds.maxTemp ? "high"
          : latest.temperature < thresholds.minTemp ? "low"
              : "ok";

  const humStatus = !latest || isNaN(latest.humidity)
      ? "none"
      : latest.humidity > thresholds.maxHum ? "high" : "ok";

  const statusDot = { idle: "#bbb", polling: "#5cb85c", error: "#d9534f", demo: "#f0ad4e" }[status];

  return (
      <>
        {/* Google Fonts */}
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f5f3ee; font-family: 'DM Sans', sans-serif; }
        input[type=number], input[type=text] {
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          font-family: 'DM Mono', monospace;
          background: #fff;
          color: #111;
          outline: none;
          transition: border-color 0.15s;
        }
        input:focus { border-color: #c0392b; }
        button {
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 7px 14px;
          font-size: 13px;
          font-family: 'DM Sans', sans-serif;
          background: transparent;
          color: #111;
          cursor: pointer;
          transition: all 0.15s;
        }
        button:hover { background: #f0ece6; }
        button.primary {
          background: #c0392b;
          color: #fff;
          border-color: #c0392b;
        }
        button.primary:hover { background: #a93226; }
      `}</style>

        <div style={styles.shell}>
          {/* Header */}
          <div style={styles.header}>
            <div>
              <div style={styles.wordmark}>sigfox monitor</div>
              <div style={styles.subline}>apartment sensor dashboard</div>
            </div>
            <div style={styles.statusPill}>
              <span style={{ ...styles.statusDot, background: statusDot }} />
              <span style={styles.statusLabel}>{status === "idle" ? "offline" : status}</span>
              {lastSeen && <span style={styles.lastSeen}>last reading {lastSeen}</span>}
            </div>
          </div>

          <AlertBanner alerts={alerts} />

          {/* Metric cards */}
          <div style={styles.metricsRow}>
            <MetricCard
                label="Temperature"
                value={latest ? fmt(latest.temperature) : "—"}
                unit="°C"
                status={tempStatus}
            />
            <MetricCard
                label="Humidity"
                value={latest ? fmt(latest.humidity, 0) : "—"}
                unit="%"
                status={humStatus}
            />
            <div style={styles.metricCard}>
              <div style={styles.metricLabel}>GPS location</div>
              {latest && !isNaN(latest.lat) ? (
                  <>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#333", marginTop: 4 }}>
                      {fmt(latest.lat, 5)}°N, {fmt(latest.lon, 5)}°E
                    </div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#888", marginTop: 2 }}>
                      alt {isNaN(latest.alt) ? "—" : fmt(latest.alt, 0)} m
                    </div>
                    <a
                        href={`https://www.google.com/maps?q=${latest.lat},${latest.lon}`}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.mapsLink}
                    >
                      Open in Maps →
                    </a>
                  </>
              ) : (
                  <div style={{ fontSize: 13, color: "#aaa", marginTop: 6 }}>Awaiting GPS fix…</div>
              )}
            </div>
          </div>

          {/* Chart */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>Sensor history</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={styles.legend}>
                  <span><span style={{ ...styles.legendDot, background: "#c0392b" }} /> Temp (°C)</span>
                  <span><span style={{ ...styles.legendDot, background: "#2980b9" }} /> Humidity (%)</span>
                </div>
                <select
                    value={chartLimit}
                    onChange={(e) => setChartLimit(Number(e.target.value))}
                    style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", color: "#555", background: "#fff" }}
                >
                  <option value={24}>Last 24</option>
                  <option value={50}>Last 50</option>
                  <option value={100}>Last 100</option>
                  <option value={500}>All</option>
                </select>
              </div>
            </div>
            {chartReady && history.length > 0
                ? <MiniChart history={history.slice(-chartLimit)} />
                : <div style={styles.chartEmpty}>{chartReady ? "No readings yet" : "Loading chart…"}</div>
            }
          </div>

          {/* Storage panel */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>Stored data</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#aaa" }}>
              {history.length} reading{history.length !== 1 ? "s" : ""} saved · localStorage
            </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => exportJSON(history)} disabled={!history.length}>Export JSON</button>
              <button onClick={() => exportCSV(history)} disabled={!history.length}>Export CSV</button>
              <button onClick={clearHistory} disabled={!history.length} style={{ color: "#c0392b", borderColor: "#f5a0a0" }}>Clear all</button>
            </div>
            {history.length > 0 && (
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#bbb", marginTop: 10 }}>
                  Oldest: {history[0].label} · Newest: {history[history.length - 1].label}
                </div>
            )}
          </div>

          {/* Controls */}
          <div style={styles.controlsRow}>
            {/* API settings */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>API settings</div>
              <div style={{ marginTop: 12 }}>
                <div style={styles.fieldLabel}>Endpoint URL</div>
                <input
                    type="text"
                    style={{ width: "100%", marginBottom: 10 }}
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="https://your-api.com/sigfox/latest"
                />
                <div style={styles.fieldLabel}>Poll interval (seconds)</div>
                <input
                    type="number"
                    value={pollInterval}
                    min={5}
                    max={3600}
                    step={1}
                    style={{ width: 80, marginBottom: 12 }}
                    onChange={(e) => setPollInterval(parseInt(e.target.value) || 30)}
                />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="primary" onClick={startPolling}>Connect</button>
                <button onClick={stopPolling}>Stop</button>
                <button onClick={loadDemo}>Load demo</button>
              </div>
              <div style={styles.pollMsg}>{pollMsg}</div>
            </div>

            {/* Thresholds */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Alert thresholds</div>
              <div style={{ marginTop: 12 }}>
                {[
                  { key: "maxTemp", label: "Max temperature", unit: "°C" },
                  { key: "minTemp", label: "Min temperature", unit: "°C" },
                  { key: "maxHum", label: "Max humidity", unit: "%" },
                ].map(({ key, label, unit }) => (
                    <div key={key} style={styles.threshRow}>
                      <label style={styles.fieldLabel}>{label}</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                            type="number"
                            style={{ width: 72 }}
                            value={thresholds[key]}
                            step={0.5}
                            onChange={(e) =>
                                setThresholds((t) => ({ ...t, [key]: parseFloat(e.target.value) }))
                            }
                        />
                        <span style={{ fontSize: 12, color: "#888" }}>{unit}</span>
                      </div>
                    </div>
                ))}
              </div>
              <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
                <button onClick={requestNotif}>
                  {notifPerm === "granted" ? "Notifications enabled ✓" : "Enable browser notifications"}
                </button>
                {notifPerm === "denied" && (
                    <div style={{ fontSize: 12, color: "#c0392b", marginTop: 6 }}>
                      Permission denied — allow in browser settings.
                    </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = {
  shell: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "32px 24px 64px",
    fontFamily: "'DM Sans', sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 28,
    flexWrap: "wrap",
    gap: 12,
  },
  wordmark: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 28,
    color: "#111",
    letterSpacing: "-0.02em",
  },
  subline: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 12,
    color: "#999",
    marginTop: 2,
    letterSpacing: "0.04em",
  },
  statusPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#fff",
    border: "1px solid #e8e4de",
    borderRadius: 999,
    padding: "6px 14px",
    fontSize: 13,
    color: "#555",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
    transition: "background 0.3s",
  },
  statusLabel: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 12,
    color: "#333",
    textTransform: "lowercase",
  },
  lastSeen: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 11,
    color: "#aaa",
    borderLeft: "1px solid #eee",
    paddingLeft: 8,
    marginLeft: 2,
  },
  alertsWrap: {
    marginBottom: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  alertBanner: {
    borderRadius: 8,
    border: "1px solid",
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  metricCard: {
    background: "#fff",
    border: "1px solid #e8e4de",
    borderRadius: 12,
    padding: "16px 20px",
  },
  metricLabel: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 11,
    color: "#aaa",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  metricValueRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
  },
  metricValue: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 36,
    color: "#111",
    lineHeight: 1,
  },
  metricUnit: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 14,
    color: "#888",
  },
  badge: {
    display: "inline-block",
    marginTop: 8,
    fontSize: 11,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: 999,
    fontFamily: "'DM Mono', monospace",
  },
  mapsLink: {
    display: "inline-block",
    marginTop: 8,
    fontSize: 12,
    color: "#2980b9",
    textDecoration: "none",
    fontFamily: "'DM Mono', monospace",
  },
  card: {
    background: "#fff",
    border: "1px solid #e8e4de",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 16,
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    flexWrap: "wrap",
    gap: 8,
  },
  cardTitle: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 12,
    color: "#aaa",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  legend: {
    display: "flex",
    gap: 16,
    fontSize: 12,
    color: "#888",
    fontFamily: "'DM Mono', monospace",
  },
  legendDot: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: 2,
    marginRight: 4,
    verticalAlign: "middle",
  },
  chartEmpty: {
    height: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ccc",
    fontSize: 13,
    fontFamily: "'DM Mono', monospace",
  },
  controlsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },
  fieldLabel: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 11,
    color: "#aaa",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: 4,
    display: "block",
  },
  threshRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  pollMsg: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 11,
    color: "#aaa",
    marginTop: 10,
  },
};