/**
 * Tasks of the Step Functions "bad-day-playbook" state machine. Each task receives the
 * incident so far and returns it with its own result added.
 *
 *   announce → speak → notify → translate → save → (wait / check)* → report
 */
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { converse, SAFETY, type CallMeta } from './bedrock'
import { doc, T, KEY, env } from './shared'

const polly = new PollyClient({})
const translate = new TranslateClient({})
const sns = new SNSClient({})
const s3 = new S3Client({})
const ssm = new SSMClient({})
const BUCKET = env('DATA_BUCKET')

interface Announcement {
  en: string
  hi: string
  sms: Record<string, string>
  staff: string
  meta: CallMeta
}

const GROUP_IDS = ['children', 'elderly', 'respiratory', 'pregnant', 'staff'] as const

function templateAnnouncement(i: any): Omit<Announcement, 'meta'> {
  const move = i.worstCoach === i.cleanCoach ? 'stay seated' : `move to coach ${i.cleanCoach}`
  return {
    en: `Attention passengers on train ${i.trainId}. Air quality in coach ${i.worstCoach} is very poor right now. Children, elderly passengers, pregnant passengers and anyone with breathing difficulty are advised to ${move}, where the air is cleanest. Please keep windows closed and wear a mask if you have one. Staff are on the way to help.`,
    hi: `यात्रीगण कृपया ध्यान दें। गाड़ी संख्या ${i.trainId} के कोच ${i.worstCoach} में इस समय हवा की गुणवत्ता बहुत खराब है। बच्चों, बुज़ुर्गों, गर्भवती महिलाओं और सांस की तकलीफ़ वाले यात्रियों से अनुरोध है कि वे कोच ${i.cleanCoach} में चले जाएँ, जहाँ हवा सबसे साफ़ है। कृपया खिड़कियाँ बंद रखें और मास्क पहनें। रेल कर्मचारी आपकी सहायता के लिए आ रहे हैं।`,
    sms: {
      children: `BreatheIQ ${i.trainId}: Air in coach ${i.worstCoach} is very poor (AQI ${i.aqi}). Please take children to coach ${i.cleanCoach} and keep windows shut. Staff will help.`,
      elderly: `BreatheIQ ${i.trainId}: Air in coach ${i.worstCoach} is very poor (AQI ${i.aqi}). Please stay seated or move to coach ${i.cleanCoach}. Wear a mask if you have one. Staff will help.`,
      respiratory: `BreatheIQ ${i.trainId}: Air in coach ${i.worstCoach} is very poor (AQI ${i.aqi}). Please wear a mask and move to coach ${i.cleanCoach}. Tell staff if you feel unwell.`,
      pregnant: `BreatheIQ ${i.trainId}: Air in coach ${i.worstCoach} is very poor (AQI ${i.aqi}). Please wear a mask and move to coach ${i.cleanCoach}. Staff will help with bags.`,
      staff: `BreatheIQ ${i.trainId}: Bad Day Mode. AQI ${i.aqi} near ${i.station}. N95 on, rounds 20 min max. Help sensitive passengers from ${i.worstCoach} to ${i.cleanCoach}.`,
    },
    staff: `Bad Day Mode on train ${i.trainId} near ${i.station}: cabin AQI ${i.aqi}. Wear N95 masks, limit rounds to 20 minutes, and help sensitive passengers move from coach ${i.worstCoach} to coach ${i.cleanCoach}. Ozone purification is ${i.interlock?.verdict === 'allowed' ? 'running in the empty cabin' : 'blocked while the cabin is occupied; ventilation is on boost'}.`,
  }
}

const ANNOUNCE_TOOL = {
  tools: [{
    toolSpec: {
      name: 'publish_announcement',
      description: 'Publish the Bad Day announcement set for this incident.',
      inputSchema: {
        json: {
          type: 'object',
          required: ['en', 'hi', 'sms', 'staff'],
          properties: {
            en: { type: 'string', description: 'Platform announcement in English, 60 words or fewer.' },
            hi: { type: 'string', description: 'The same announcement in Hindi (Devanagari), 60 words or fewer.' },
            sms: {
              type: 'object', description: 'One SMS advisory per group, each 300 characters or fewer.',
              required: [...GROUP_IDS],
              properties: Object.fromEntries(GROUP_IDS.map((g) => [g, { type: 'string' }])),
            },
            staff: { type: 'string', description: 'One instruction for on-board staff.' },
          },
        },
      },
    },
  }],
  toolChoice: { tool: { name: 'publish_announcement' } },
}

async function announce(i: any) {
  const r = await converse({
    useCase: 'bad-day-announcer', tier: 'fast', maxTokens: 1200, toolConfig: ANNOUNCE_TOOL as any,
    system: `${SAFETY} Write the announcement set for a Bad Day incident. Name the worst and the cleanest coach. English and Hindi announcements are 60 words or fewer each; each SMS is 300 characters or fewer and addressed to its group.`,
    messages: [{ role: 'user', content: [{ text: `Incident:\n${JSON.stringify({ trainId: i.trainId, aqi: i.aqi, pm25: i.pm25, station: i.station, worstCoach: i.worstCoach, worstAqi: i.worstAqi, cleanCoach: i.cleanCoach, cleanAqi: i.cleanAqi, groups: i.groups, interlock: i.interlock })}` }] }],
  })
  const t = r.ok && r.toolInput?.en && r.toolInput?.hi && r.toolInput?.sms ? r.toolInput : null
  const body = t ? { en: String(t.en), hi: String(t.hi), sms: t.sms, staff: String(t.staff ?? '') } : templateAnnouncement(i)
  const meta: CallMeta = t ? r.meta : { ...r.meta, engine: 'template' }
  return { ...i, announcement: { ...body, meta } }
}

async function speak(i: any) {
  const audio: Record<string, any> = {}
  for (const [lang, code] of [['en', 'en-IN'], ['hi', 'hi-IN']] as const) {
    const key = `audio/${i.incidentId}/${lang}.mp3`
    try {
      const res = await polly.send(new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: 'Kajal', LanguageCode: code, OutputFormat: 'mp3', Text: i.announcement[lang] }))
      const bytes = await res.AudioStream!.transformToByteArray()
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: 'audio/mpeg' }))
      audio[lang] = { key, voice: 'Kajal', engine: 'neural', languageCode: code, characters: res.RequestCharacters, bytes: bytes.length }
    } catch (e) {
      audio[lang] = { error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 200) }
    }
  }
  return { ...i, audio }
}

const mask = (n: string) => n.replace(/.(?=.{3})/g, '•')

async function notify(i: any) {
  const out: any = { email: null, sms: [] }
  try {
    const r = await sns.send(new PublishCommand({
      TopicArn: env('STAFF_TOPIC_ARN'),
      Subject: `BreatheIQ Bad Day Mode · train ${i.trainId} · AQI ${i.aqi}`,
      Message: `${i.announcement.staff}\n\nTrigger: ${i.trigger}\nStation: ${i.station}\nWorst coach: ${i.worstCoach} (AQI ${i.worstAqi})\nCleanest coach: ${i.cleanCoach} (AQI ${i.cleanAqi})\n\nPlatform announcement:\n${i.announcement.en}`,
    }))
    out.email = { messageId: r.MessageId, topic: 'staff-alerts' }
  } catch (e) {
    out.email = { error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 200) }
  }
  let numbers: string[] = []
  try {
    const p = await ssm.send(new GetParameterCommand({ Name: env('SMS_PARAM'), WithDecryption: true }))
    numbers = (p.Parameter?.Value ?? '').split(',').map((s) => s.trim()).filter((s) => /^\+\d{8,15}$/.test(s))
  } catch { /* parameter not set: no numbers verified yet */ }
  if (!numbers.length) out.smsNote = 'No verified phone numbers are configured.'
  for (const n of numbers) {
    try {
      const r = await sns.send(new PublishCommand({ PhoneNumber: n, Message: i.announcement.sms.respiratory ?? i.announcement.staff }))
      out.sms.push({ to: mask(n), messageId: r.MessageId })
    } catch (e) {
      out.sms.push({ to: mask(n), error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 160) })
    }
  }
  return { ...i, sns: out }
}

async function translateStep(i: any) {
  const lang = env('EXTRA_LANGUAGE', 'bn')
  try {
    const r = await translate.send(new TranslateTextCommand({ Text: i.announcement.en, SourceLanguageCode: 'en', TargetLanguageCode: lang }))
    return { ...i, translation: { language: lang, text: r.TranslatedText } }
  } catch (e) {
    return { ...i, translation: { language: lang, error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 200) } }
  }
}

async function save(i: any, executionArn?: string) {
  const item = { ...i, pk: i.incidentId, status: 'open', peakAqi: i.aqi, executionArn, savedAt: Date.now(), loops: 0 }
  await doc.send(new PutCommand({ TableName: T.incidents, Item: item }))
  return item
}

async function check(i: any) {
  const s = (await doc.send(new GetCommand({ TableName: T.state, Key: { pk: KEY } }))).Item
  const bd = s?.badDay
  const mine = bd?.incidentId === i.incidentId
  const open = mine && !!bd?.active
  const peakAqi = Math.max(i.peakAqi ?? 0, mine ? bd?.peakAqi ?? 0 : 0)
  if (peakAqi > (i.peakAqi ?? 0)) {
    await doc.send(new UpdateCommand({ TableName: T.incidents, Key: { pk: i.incidentId }, UpdateExpression: 'SET peakAqi = :p', ExpressionAttributeValues: { ':p': peakAqi } }))
  }
  return { ...i, peakAqi, loops: (i.loops ?? 0) + 1, closed: !open, endedAt: open ? null : Date.now(), aqiAtClose: s?.reading?.aqi ?? null }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })

function templateReport(i: any) {
  const mins = i.endedAt ? Math.max(1, Math.round((i.endedAt - i.startedAt) / 60000)) : null
  return `
<h2>Summary</h2>
<p>At ${hhmm(i.startedAt)} IST, near ${esc(i.station)}, cabin air on train ${esc(i.trainId)} went off the CPCB chart (AQI ${esc(i.aqi)}). Bad Day Mode ran for ${mins ?? 'several'} minute${mins === 1 ? '' : 's'} and peaked at AQI ${esc(i.peakAqi)}. The worst coach was ${esc(i.worstCoach)} (AQI ${esc(i.worstAqi)}); the cleanest was ${esc(i.cleanCoach)} (AQI ${esc(i.cleanAqi)}).</p>
<h2>Timeline</h2>
<ul>
<li>${hhmm(i.startedAt)} · Trigger: ${esc(i.trigger)}.</li>
<li>${hhmm(i.startedAt)} · Ventilation boost. Ozone interlock: ${esc(i.interlock?.verdict)}${i.interlock?.reason ? ` (${esc(i.interlock.reason)})` : ''}.</li>
<li>${hhmm(i.savedAt ?? i.startedAt)} · Announcement issued in English and Hindi; staff notified; advisory translated (${esc(i.translation?.language)}).</li>
${i.endedAt ? `<li>${hhmm(i.endedAt)} · Stand down. AQI at close: ${esc(i.aqiAtClose)}.</li>` : ''}
</ul>
<h2>Actions taken</h2>
<ul>
<li>Sensitive passengers advised to move from ${esc(i.worstCoach)} to ${esc(i.cleanCoach)}.</li>
<li>Staff instruction: ${esc(i.announcement?.staff)}</li>
<li>SMS advisories: ${i.sns?.sms?.length ? `${i.sns.sms.filter((m: any) => m.messageId).length} delivered to SNS` : esc(i.sns?.smsNote ?? 'none sent')}.</li>
</ul>
<h2>What to improve</h2>
<ul>
<li>Forward PM2.5 and PM10 in the device frame so AQI does not depend on a derived value.</li>
<li>Add occupancy sensing so the ozone interlock runs on a measured signal.</li>
<li>Pre-emptively boost ventilation before known pollution zones on the route.</li>
</ul>`
}

async function report(i: any) {
  const record = {
    trainId: i.trainId, station: i.station, trigger: i.trigger, startedAt: new Date(i.startedAt).toISOString(),
    endedAt: i.endedAt ? new Date(i.endedAt).toISOString() : null, aqiAtStart: i.aqi, peakAqi: i.peakAqi, aqiAtClose: i.aqiAtClose,
    worstCoach: i.worstCoach, worstAqi: i.worstAqi, cleanCoach: i.cleanCoach, cleanAqi: i.cleanAqi,
    interlock: i.interlock, groups: i.groups, staffInstruction: i.announcement?.staff, announcementEn: i.announcement?.en,
    smsSent: i.sns?.sms?.filter((m: any) => m.messageId).length ?? 0, translation: i.translation?.language,
  }
  const r = await converse({
    useCase: 'incident-report', tier: 'strong', maxTokens: 1500,
    system: `${SAFETY} Write a narrative incident report as an HTML fragment using only <h2>, <p>, <ul> and <li>. Sections in this order: Summary, Timeline, Actions taken, What to improve. Use only facts from the record. No markdown, no <html> or <body> tags.`,
    messages: [{ role: 'user', content: [{ text: `Incident record:\n${JSON.stringify(record)}` }] }],
  })
  const fragment = r.ok && r.text.includes('<h2') ? r.text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/```(html)?/g, '') : templateReport(i)
  const meta: CallMeta = r.ok && r.text.includes('<h2') ? r.meta : { ...r.meta, engine: 'template' }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BreatheIQ incident ${esc(i.incidentId)}</title>
<style>body{font:16px/1.6 Inter,system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#14181f}h1{font-size:28px;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#5b6472;margin:32px 0 8px}.meta{font:12px/1.5 ui-monospace,monospace;color:#5b6472}li{margin:4px 0}</style></head>
<body><h1>Incident report · train ${esc(i.trainId)}</h1><p class="meta">${esc(i.incidentId)} · peak AQI ${esc(i.peakAqi)} · written by ${meta.engine === 'bedrock' ? `Amazon Bedrock (${esc(meta.modelId)})` : 'the BreatheIQ report template'}</p>${fragment}</body></html>`
  const key = `reports/${i.incidentId}.html`
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: html, ContentType: 'text/html; charset=utf-8' }))
  await doc.send(new UpdateCommand({
    TableName: T.incidents, Key: { pk: i.incidentId },
    UpdateExpression: 'SET #s = :s, endedAt = :e, peakAqi = :p, aqiAtClose = :a, reportKey = :k, reportMeta = :m',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': 'closed', ':e': i.endedAt ?? Date.now(), ':p': i.peakAqi, ':a': i.aqiAtClose ?? null, ':k': key, ':m': meta },
  }))
  return { incidentId: i.incidentId, status: 'closed', reportKey: key, reportEngine: meta.engine, peakAqi: i.peakAqi }
}

export const handler = async (event: { step: string; incident: any; executionArn?: string }) => {
  const i = event.incident
  switch (event.step) {
    case 'announce': return announce(i)
    case 'speak': return speak(i)
    case 'notify': return notify(i)
    case 'translate': return translateStep(i)
    case 'save': return save(i, event.executionArn)
    case 'check': return check(i)
    case 'report': return report(i)
    default: throw new Error(`Unknown playbook step ${event.step}`)
  }
}
