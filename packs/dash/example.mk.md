---
title: Service Dashboard
uses: [dash]
---

# Service Dashboard

::dash_gauge{data=metrics.cpu min=0 max=100 label="CPU" unit="%"}

::dash_gauge{data=metrics.mem min=0 max=100 label="Memory" unit="%"}

::dash_sparkline{data=metrics.latency label="Latency (ms)"}

## Services

:dash_status[API server]{state=ok}

:dash_status[Database]{state=warn}

:dash_status[Cache]{state=down}

## API uptime, last 24h

::dash_uptime{data=metrics.history label="API uptime"}

Requests are up :dash_delta[on yesterday]{value=128}, while the error rate
moved :dash_delta[over the same day]{value=-0.4 unit="%"}.

```lua {name=metrics}
-- Static demo data: a monitoring pack's real script would call an API
-- through net.fetch_json and cache it, the way the hn-pulse example does.
-- This one stays offline so the pack's example runs with no network.
return {
  cpu = 63,
  mem = 81,
  latency = { 12, 14, 13, 18, 22, 19, 15, 17, 16, 20 },
  history = {
    "ok", "ok", "ok", "warn", "ok", "ok", "down", "ok", "ok", "ok",
    "ok", "warn", "ok", "ok", "ok", "ok", "ok", "down", "ok", "ok",
  },
}
```
