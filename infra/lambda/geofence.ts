/**
 * Amazon Location geofences for the route zones (crop-burning belt, tunnel, yards).
 *
 *   { internal: 'setup' }            → store the zone polygons in the geofence collection
 *   Location Geofence Event (ENTER)  → pre-emptive ventilation for the coach + an alert
 *   Location Geofence Event (EXIT)   → release it
 */
import { LocationClient, BatchPutGeofenceCommand } from '@aws-sdk/client-location'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { ZONE_POLYGONS } from '../../breatheiq/src/sim/geo'
import { doc, T, KEY, TRAIN_ID, COACH, env, emit, ttl } from './shared'

const location = new LocationClient({})
export const PREVENT_KEY = `${TRAIN_ID}#PREVENT`

export const handler = async (event: any) => {
  if (event.internal === 'setup') {
    const r = await location.send(new BatchPutGeofenceCommand({
      CollectionName: env('GEOFENCE_COLLECTION'),
      Entries: ZONE_POLYGONS.map((z) => ({ GeofenceId: z.id, Geometry: { Polygon: [z.polygon] }, GeofenceProperties: { kind: z.kind, label: z.label } })),
    }))
    return { stored: r.Successes?.length ?? 0, errors: r.Errors ?? [] }
  }

  const d = event.detail ?? {}
  const zone = ZONE_POLYGONS.find((z) => z.id === d.GeofenceId)
  if (!zone) return { ignored: d.GeofenceId }
  const entering = d.EventType === 'ENTER'
  const ts = Date.now()
  await doc.send(new PutCommand({
    TableName: T.state,
    Item: { pk: PREVENT_KEY, active: entering, zone: zone.label, kind: zone.kind, geofenceId: zone.id, at: ts, until: entering ? ts + 5 * 60_000 : ts },
  }))
  if (entering) {
    await doc.send(new PutCommand({
      TableName: T.alerts,
      Item: { pk: KEY, sk: ts * 10 + 9, ts, ruleId: 'geofence', text: `Entering ${zone.label} → Pre-emptive ventilation`, ttl: ttl(72) },
    }))
  }
  await emit(entering ? 'GeofenceEntered' : 'GeofenceExited', { trainId: TRAIN_ID, coach: COACH, ts, zone: zone.label, kind: zone.kind, geofenceId: zone.id })
  return { zone: zone.label, entering }
}
