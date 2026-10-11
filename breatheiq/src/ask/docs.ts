/**
 * Knowledge Base documents. The same files are uploaded to S3 for the Bedrock Knowledge Base
 * (scripts/post-deploy.mjs) and bundled here so the assistant can cite them offline.
 */
import cpcb from './kb/cpcb-aqi.md?raw'
import limits from './kb/who-naaqs-limits.md?raw'
import ozone from './kb/ozone-safety.md?raw'
import sensors from './kb/sensors.md?raw'
import groups from './kb/sensitive-groups.md?raw'
import playbook from './kb/bad-day-playbook.md?raw'

export interface KbDoc {
  file: string
  title: string
  text: string
}

export const DOCS: KbDoc[] = [
  { file: 'cpcb-aqi.md', title: 'CPCB National AQI', text: cpcb },
  { file: 'who-naaqs-limits.md', title: 'WHO 2021 and India NAAQS limits', text: limits },
  { file: 'ozone-safety.md', title: 'Ozone safety and the interlock', text: ozone },
  { file: 'sensors.md', title: 'Sensor datasheet summary', text: sensors },
  { file: 'sensitive-groups.md', title: 'Sensitive groups and exposure guidance', text: groups },
  { file: 'bad-day-playbook.md', title: 'Bad Day playbook', text: playbook },
]
