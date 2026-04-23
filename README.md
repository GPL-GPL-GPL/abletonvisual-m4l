# abletonvisual-m4l

Max for Live devices that bridge Ableton Live to the [AbletonVisual](https://github.com/GPL-GPL-GPL/AbletonVisual) desktop app over OSC/UDP.

## Devices

### av Sync Sender
Drop one instance on every track you want to visualize. Each instance is a **lane** — it streams audio analysis and registers itself with the hub. Exactly one sender should be set to `master` role; it additionally streams transport and section data.

### av Sync Hub
Drop one instance anywhere in the Live set (one per set). It owns the handshake with the AbletonVisual app and relays all lane traffic from the senders.

## Setup

1. Build the `.amxd` bundles: `npm run build`
2. Copy `package/av-sync-sender/av Sync Sender.amxd` and `package/av-sync-hub/av Sync Hub.amxd` into your Ableton User Library.
3. Launch AbletonVisual, then load your Live set.
4. Drop **av Sync Hub** anywhere in the set.
5. Drop **av Sync Sender** on each track to visualize. Set one sender to `master` role.

## OSC protocol

All messages are UDP on `127.0.0.1`. The hub listens on **7788**; the app listens on a port in **9100–9119** (auto-discovered via hello scan).

### Lane → App (via hub, outbound port 7777)

| Address | Args | Description |
|---------|------|-------------|
| `/av/lane/register` | `laneId laneName role trackName` | Sent on boot, role/name change, and every ~1 s |
| `/av/lane/frame` | `laneId level rms peak sub bass lowMid highMid presence air centroid flux gate sustain` | Audio analysis frame (~30 fps) |
| `/av/lane/event` | `laneId type strength` | Transient event (e.g. `onset`, `beat`) |
| `/av/master/transport` | `tempo isPlaying beatPhase barPhase` | Master lane only, per poll tick |
| `/av/master/section` | `name progress` | Master lane only, current arrangement section |
| `/av/debug` | `laneId level message` | Debug log from sender |

### Handshake (hub ↔ app)

| Address | Direction | Args | Description |
|---------|-----------|------|-------------|
| `/av/hs/hello` | hub → app | `schemaVersion hubVersion hubPort nonce` | Hub announces itself during port scan |
| `/av/hs/welcome` | app → hub | `sessionId schemaVersion hubVersion nonce accepted [rejectReason]` | App accepts or rejects |
| `/av/hs/lane_register` | hub → app | `sessionId laneId laneName role trackName nonce` | Hub registers a lane with the app |
| `/av/hs/lane_ack` | app → hub | `sessionId laneId assignedRole nonce` | App acknowledges lane registration |
| `/av/hs/ping` | hub → app | `sessionId seq tsMs` | Heartbeat ping |
| `/av/hs/pong` | app → hub | `sessionId seq tsMs` | Heartbeat reply |
| `/av/hs/bye` | either | `sessionId reason` | Session teardown |

### Schema version

Current protocol schema version: **1**. The hub and app must agree on schema version or the session is rejected.

## Build output

`npm run build` populates `package/` (gitignored):

```
package/
  av-sync-sender/
    av Sync Sender.amxd   ← drop into Ableton User Library
    av-sync-sender.maxpat
    av_sync_sender.js
    audio_analyzer.js
    transport_poller.js
    av_util.js
    manifest.json
    README.md
  av-sync-hub/
    av Sync Hub.amxd
    av-sync-hub.maxpat
    av_sync_hub.js
    config_loader.js
    osc_emitter.js
    osc_receiver.js
    handshake_client.js
    av_util.js
    manifest.json
    README.md
```
