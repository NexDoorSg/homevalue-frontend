import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildLeadSyncPayload,
  buildPropertyIdentityPayload,
} from '../src/lib/propertyIdentity.ts'
import { displayEmailHtmlValue } from '../src/lib/emailHtml.ts'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const pagePaths = [
  'src/app/page.tsx',
  'src/app/free-property-valuation-singapore/page.tsx',
]
const routePath = 'src/app/api/send-lead/route.ts'

function readRepositoryFile(path) {
  return readFileSync(`${repositoryRoot}/${path}`, 'utf8')
}

function section(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`)

  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`)

  return source.slice(startIndex, endIndex)
}

test('canonical project name wins and repeated whitespace is collapsed', () => {
  const identity = buildPropertyIdentityPayload({
    canonicalProjectName: '  The   Canonical   Residences ',
    oneMapBuilding: 'Raw OneMap Building',
  })

  assert.equal(identity.project_name, 'The Canonical Residences')
})

test('OneMap building is the fallback when no canonical name exists', () => {
  const identity = buildPropertyIdentityPayload({
    canonicalProjectName: null,
    oneMapBuilding: '  Raw   OneMap Building  ',
  })

  assert.equal(identity.project_name, 'Raw OneMap Building')
})

test('blank and NIL project names normalize to null without blocking a valid fallback', () => {
  for (const value of ['', '   ', 'NIL', ' nil ', '\n\t']) {
    assert.equal(
      buildPropertyIdentityPayload({
        canonicalProjectName: value,
        oneMapBuilding: value,
      }).project_name,
      null
    )
  }

  assert.equal(
    buildPropertyIdentityPayload({
      canonicalProjectName: ' nil ',
      oneMapBuilding: 'Fallback Heights',
    }).project_name,
    'Fallback Heights'
  )
})

test('valid Singapore postal codes are preserved and normalized', () => {
  assert.equal(
    buildPropertyIdentityPayload({ postalCode: '569418' }).postal_code,
    '569418'
  )
  assert.equal(
    buildPropertyIdentityPayload({ postalCode: 'Singapore 569418' }).postal_code,
    '569418'
  )
})

test('blank and invalid postal codes normalize to null', () => {
  for (const value of ['', '   ', '56941', '5694187', 'postal 569418', 'ABCDEF']) {
    assert.equal(
      buildPropertyIdentityPayload({ postalCode: value }).postal_code,
      null
    )
  }
})

test('address and unit number preserve the existing values exactly', () => {
  const identity = buildPropertyIdentityPayload({
    address: '  10 Example Road Singapore 569418  ',
    unitNumber: '#03-07',
  })

  assert.equal(identity.address, '  10 Example Road Singapore 569418  ')
  assert.equal(identity.unit_number, '#03-07')
})

test('legacy lead payloads remain accepted and receive all four nullable keys', () => {
  const outgoing = buildLeadSyncPayload(
    {
      name: 'Legacy Caller',
      source: 'consultation',
      pageSource: '/legacy',
    },
    {}
  )

  assert.deepEqual(outgoing, {
    name: 'Legacy Caller',
    source: 'consultation',
    pageSource: '/legacy',
    project_name: null,
    postal_code: null,
    address: null,
    unit_number: null,
  })
})

test('email HTML display values escape individual special characters', () => {
  assert.equal(displayEmailHtmlValue('&'), '&amp;')
  assert.equal(displayEmailHtmlValue('<value>'), '&lt;value&gt;')
  assert.equal(displayEmailHtmlValue('"quoted"'), '&quot;quoted&quot;')
  assert.equal(displayEmailHtmlValue("owner's"), 'owner&#39;s')
})

test('email HTML display values safely escape combined HTML-like input', () => {
  assert.equal(
    displayEmailHtmlValue(`<a href="x&y">Owner's home</a>`),
    '&lt;a href=&quot;x&amp;y&quot;&gt;Owner&#39;s home&lt;/a&gt;'
  )
})

test('email HTML display values retain fallback and ordinary-text behaviour', () => {
  assert.equal(displayEmailHtmlValue(null), '-')
  assert.equal(displayEmailHtmlValue(undefined), '-')
  assert.equal(displayEmailHtmlValue(''), '-')
  assert.equal(displayEmailHtmlValue('Maple Residences 569418'), 'Maple Residences 569418')
})

test('both valuation pages isolate database payloads from structured sync identity', () => {
  for (const path of pagePaths) {
    const source = readRepositoryFile(path)
    const leadBuilder = section(
      source,
      '  const buildLeadPayload = (',
      '  const buildPartialLeadPayload = ('
    )
    const partialLeadBuilder = section(
      source,
      '  const buildPartialLeadPayload = (',
      '  const savePartialLead = async ('
    )
    const sender = section(
      source,
      '  const sendLeadEmail = async (',
      '  const handleConsultationSubmit = async ('
    )

    assert.doesNotMatch(leadBuilder, /\bproject_name\b|\bpostal_code\b/, path)
    assert.doesNotMatch(partialLeadBuilder, /\bproject_name\b|\bpostal_code\b/, path)
    assert.match(sender, /buildLeadSyncPayload\(payload, \{/)
    assert.match(sender, /body: JSON\.stringify\(outgoingPayload\)/)
    assert.equal(
      source.match(/fetch\('\/api\/send-lead'/g)?.length,
      1,
      `${path} must have one shared send boundary`
    )
  }
})

test('full-report, normal, consultation, and plan-popup paths share the sender', () => {
  for (const path of pagePaths) {
    const source = readRepositoryFile(path)
    const fullReport = section(
      source,
      '  const handleUnlockFullReport = async () => {',
      '  const sendLeadEmail = async ('
    )
    const consultation = section(
      source,
      '  const handleConsultationSubmit = async () => {',
      '  const handleLeadSubmit = async () => {'
    )
    const normalLead = section(
      source,
      '  const handleLeadSubmit = async () => {',
      '  const handlePlanSelect = async ('
    )
    const planPopup = section(
      source,
      '  const handlePlanSelect = async (',
      '  const handlePopupDismiss = () => {'
    )

    for (const handler of [fullReport, consultation, normalLead, planPopup]) {
      assert.match(handler, /sendLeadEmail\(/, path)
    }
  }
})

test('both fallback OneMap resolvers retain POSTAL and canonical state cannot go stale', () => {
  for (const path of pagePaths) {
    const source = readRepositoryFile(path)
    const addressSelection = section(
      source,
      '  const handleSelectAddress = (item: OneMapResult) => {',
      '  const resolveAddressForGeneration = async () => {'
    )
    const resolver = section(
      source,
      '  const resolveAddressForGeneration = async () => {',
      '  const handleGenerateReport = async ('
    )
    const reset = section(
      source,
      '  const resetResults = () => {',
      '  const handleAddressChange = ('
    )

    assert.match(addressSelection, /setSelectedPostal\(item\.POSTAL \|\| null\)/)
    assert.match(resolver, /const resolvedPostal = chosen\.POSTAL \|\| null/)
    assert.match(resolver, /setSelectedPostal\(resolvedPostal\)/)
    assert.match(resolver, /postalCode: resolvedPostal/)
    assert.match(source, /setResolvedProjectNameState\(resolvedProjectName\)/)
    assert.match(reset, /setResolvedProjectNameState\(null\)/)
  }
})

test('send-lead normalizes the exact identity keys before preserving Office metadata', () => {
  const source = readRepositoryFile(routePath)
  const syncFunction = section(
    source,
    'async function syncLeadToOffice(',
    'export async function POST('
  )

  assert.match(
    source,
    /const officePayload = buildLeadSyncPayload\(body, \{[\s\S]*canonicalProjectName: project_name,[\s\S]*postalCode: postal_code,[\s\S]*address,[\s\S]*unitNumber: unit_number,/
  )
  assert.match(source, /syncLeadToOffice\(officePayload\)/)
  assert.match(syncFunction, /"x-nexdoor-source": "HomeValue"/)
  assert.match(syncFunction, /"x-nexdoor-sync-token": syncToken/)
  assert.match(syncFunction, /\.\.\.body,[\s\S]*source: "HomeValue"/)
  assert.match(
    syncFunction,
    /pageSource: body\.pageSource \|\| body\.page_source \|\| "HomeValue"/
  )
})

test('send-lead email HTML safely renders every external text field', () => {
  const source = readRepositoryFile(routePath)
  const emailHtml = section(source, '      html: `', '      `,\n    });')

  for (const value of [
    'name',
    'phone',
    'email',
    'officePayload.project_name',
    'officePayload.postal_code',
    'officePayload.address',
    'officePayload.unit_number',
    'unit_type',
    'intent',
    'officeSync.assignedTo',
  ]) {
    assert.match(
      emailHtml,
      new RegExp(`\\$\\{displayEmailHtmlValue\\(${value.replace('.', '\\.')}\\)\\}`)
    )
  }

  assert.doesNotMatch(emailHtml, /\$\{displayValue\(/)
  assert.doesNotMatch(emailHtml, /\$\{intent\}/)
})

test('Office assignment still gates WhatsApp and intent/agent mappings are unchanged', () => {
  const source = readRepositoryFile(routePath)
  const officeSyncIndex = source.indexOf('const officeSync = await syncLeadToOffice')
  const whatsappGateIndex = source.indexOf(
    'if (officeSync.ok && shouldSendWhatsappIntro)'
  )
  const whatsappSendIndex = source.indexOf('await sendHomeValueWhatsappIntro({')

  assert.ok(officeSyncIndex >= 0)
  assert.ok(whatsappGateIndex > officeSyncIndex)
  assert.ok(whatsappSendIndex > whatsappGateIndex)
  assert.match(source, /assignedTo: officeLead\?\.assignedTo \|\| null/)

  for (const alias of [
    'sell',
    'selling',
    'looking to sell',
    'thinking of selling',
    'buy',
    'buying',
    'looking to buy',
    'thinking of buying',
    'just exploring',
    'just exploring my options',
    'exploring',
  ]) {
    assert.match(source, new RegExp(`"${alias}"`))
  }

  for (const agent of [
    'bjornlim@nexdoor.sg',
    'abigailtang@nexdoor.sg',
    'daveteo@nexdoor.sg',
  ]) {
    assert.match(source, new RegExp(`"${agent}"`))
  }
})
