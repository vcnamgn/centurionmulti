const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../centurion-logs');
test('journaux : événements dédupliqués et essais distincts après réinitialisation et chargement',()=>{
  const logs=L.create({now:()=> '2026-10-18T03:00:00.000Z',maxRuns:3,maxSession:3});
  const model={state:{time:5,events:[{time:4,kind:'protection',text:'AAR engagé'}]}};
  logs.observe(model);logs.observe(model);assert.equal(logs.snapshot().runs[0].events.length,1);
  logs.begin('Réinitialisation');logs.observe({state:{time:0,events:[]}});
  logs.begin('État chargé : exercice.json',80);logs.observe(model);
  assert.deepEqual(logs.snapshot().runs.map(r=>r.label),['Démarrage','Réinitialisation','État chargé : exercice.json']);
  logs.session('Connecté');logs.session('Connecté');logs.session('Édition transférée');assert.equal(logs.snapshot().session.length,2);
  for(let i=0;i<10;i++)logs.session('Moment '+i);assert.equal(logs.snapshot().session.length,3);
  const aux=L.create();aux.session('Auxiliaire connecté');aux.receive(logs.snapshot());assert.equal(aux.data().runs.length,3);assert.match(aux.data().session.at(-1).text,/Ce navigateur/);
});
