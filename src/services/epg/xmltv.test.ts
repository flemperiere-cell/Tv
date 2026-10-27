import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { parseXmltv, parseXmltvDate } from './xmltv'
import { parseXmltvGzipStream } from './xmltv'
describe('XMLTV', () => {
  it('respecte les offsets et le changement heure hiver', () => {
    expect(parseXmltvDate('20261025025500 +0200').toISOString()).toBe('2026-10-25T00:55:00.000Z')
    expect(parseXmltvDate('20261025025500 +0100').toISOString()).toBe('2026-10-25T01:55:00.000Z')
  })
  it('normalise programmes, épisodes, crédits et données partielles', () => {
    const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="20261026205000 +0100" stop="20261026215000 +0100" channel="TF1.fr"><title>Journal</title><category>Information</category><credits><director>Jane Doe</director><actor role="Alice">Jeanne Dupont</actor><presenter>Jean Martin</presenter></credits><date>2026</date><country>France</country><rating system="CSA"><value>-10</value></rating><star-rating><value>4/5</value></star-rating><episode-num system="xmltv_ns">1.5.</episode-num><new/></programme><programme start="x" stop="y" channel="TF1.fr"><title>Cassé</title></programme></tv>`
    const r = parseXmltv(xml)
    expect(r.channels[0].number).toBe(1)
    expect(r.programmes).toHaveLength(1)
    expect(r.programmes[0]).toMatchObject({
      title: 'Journal',
      durationMinutes: 60,
      season: 2,
      episode: 6,
      isNew: true,
      year: '2026',
      countries: ['France'],
      rating: '-10',
      ratingSystem: 'CSA',
      starRating: '4/5',
      credits: {
        directors: ['Jane Doe'],
        actors: [{ name: 'Jeanne Dupont', role: 'Alice' }],
        presenters: ['Jean Martin'],
      },
    })
  })
  it('rejette le XML invalide', () => expect(() => parseXmltv('<tv>')).toThrow())
  it('conserve les numéros 1-based et la saison spéciale 0', () => {
    const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="20261026205000 +0100" stop="20261026215000 +0100" channel="TF1.fr"><title>Épisode spécial</title><category>Série</category><episode-num system="xmltv_ns">-1.0.</episode-num></programme></tv>`
    expect(parseXmltv(xml).programmes[0]).toMatchObject({ season: 0, episode: 1 })
  })
  it('conserve toutes les catégories et préfère la durée XMLTV à la durée du créneau', () => {
    const xml = `<tv><channel id="M6.fr"><display-name>M6</display-name></channel><programme start="20261027211000 +0100" stop="20261027225000 +0100" channel="M6.fr"><title>Les farouches</title><category>Téléfilm policier</category><category>Drame</category><length units="minutes">90</length><desc>Deux policiers se détestent.</desc></programme></tv>`
    const programme = parseXmltv(xml).programmes[0]
    expect(programme).toMatchObject({
      category: 'Téléfilm policier',
      categories: ['Téléfilm policier', 'Drame'],
      durationMinutes: 90,
      xmltvLengthMinutes: 90,
    })
  })
  it('conserve catégories et durée <length> dans le parseur XMLTV en flux', async () => {
    const xml = `<tv><channel id="M6.fr"><display-name>M6</display-name></channel><programme start="20261027211000 +0100" stop="20261027225000 +0100" channel="M6.fr"><title>Les farouches</title><category>Téléfilm policier</category><category>Drame</category><length units="minutes">90</length></programme></tv>`
    const response = new Response(gzipSync(xml), {
      headers: { 'content-type': 'application/gzip' },
    })
    const result = await parseXmltvGzipStream(response)
    expect(result.programmes[0]).toMatchObject({
      category: 'Téléfilm policier',
      categories: ['Téléfilm policier', 'Drame'],
      durationMinutes: 90,
      xmltvLengthMinutes: 90,
    })
  })
})
