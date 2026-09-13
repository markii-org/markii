# Auto trigger, a write attempt

Runs on open, on a timer, or manually. This script only ever attempts an
effect (a write), never a network call, so the tier gate is the only
thing that can deny it.

```lua {name=counter}
store.set("counter", 1)
return store.get("counter")
```
