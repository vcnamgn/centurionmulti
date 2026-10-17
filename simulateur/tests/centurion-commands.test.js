const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../centurion-engine.js'),Auto=require('../centurion-auto.js');
const Commands=require('../centurion-commands.js');

function contextFor(model=E.make(),regulationActive=false){
  const context={E,model,regulationActive,
    setRegulationActive(value){context.regulationActive=Boolean(value);},
    setProtectionActive(value){model.controls.protectionsEnabled=Boolean(value);},
    setRManualOverride(value){E.setRManualOverride(model,value);}};
  return context;
}

test('point d’entrée : catalogue existant et refus des commandes hors contrat',()=>{
  const context=contextFor(),commands=Commands.create({getContext:()=>context});
  assert.deepEqual(commands.catalog(),Auto.actionCatalog());
  const before=structuredClone(context.model);
  for(const input of [null,[],{}, {id:'heater'}, {id:'heater',value:500,state:{}},
    {id:'__proto__',value:1}, {id:'heater',value:Infinity}, {id:'heater',value:2501}])
    assert.throws(()=>commands.execute(input));
  assert.deepEqual(context.model,before);
});

test('validation sans effet et application sans avancer la physique',()=>{
  const context=contextFor(),commands=Commands.create({getContext:()=>context});
  const before=structuredClone(context.model);
  assert.deepEqual(commands.validate({id:'heater',value:450}),{id:'heater',value:450});
  assert.deepEqual(context.model,before);
  commands.execute({id:'heater',value:450});
  assert.equal(context.model.controls.manualHeaterKW,450);
  assert.deepEqual(context.model.state,before.state);
});

test('valeurs nulles et énumérations gardent le sens du catalogue',()=>{
  const context=contextFor(),commands=Commands.create({getContext:()=>context});
  commands.execute({id:'turbine.rate',value:null});
  assert.equal(context.model.controls.manualTurbineRatePctMin,null);
  commands.execute({id:'ris.source',value:'recirculation'});
  assert.equal(context.model.controls.risSourceMode,'recirculation');
  assert.throws(()=>commands.execute({id:'ris.source',value:'inconnue'}),/Valeur/);
});

test('les priorités CC et la fin de partie restent imposées par le métier',()=>{
  const context=contextFor(E.make(),true),commands=Commands.create({getContext:()=>context});
  assert.throws(()=>commands.execute({id:'heater',value:450}),/CC-RÉGUL/);
  assert.throws(()=>commands.execute({id:'rods.R',value:100}),/manuel/);
  context.model.state.endState='safe';
  assert.throws(()=>commands.execute({id:'turbine.target',value:80}),/terminée/);
});

test('un programme turbine actif conserve sa priorité sur la demande manuelle',()=>{
  const context=contextFor(),commands=Commands.create({getContext:()=>context});
  E.startTransient(context.model,'pilotage');
  const before=structuredClone(context.model);
  assert.throws(()=>commands.execute({id:'turbine.target',value:80}),/transitoire/);
  assert.deepEqual(context.model,before);
});

test('groupe : changement de mode puis commande dans l’ordre, validation sans effet',()=>{
  const context=contextFor(E.make(),true),commands=Commands.create({getContext:()=>context});
  const list=[{id:'regulation.enabled',value:0},{id:'heater',value:450}];
  const before=structuredClone(context.model);
  commands.validateMany(list);
  assert.equal(context.regulationActive,true);
  assert.deepEqual(context.model,before);
  commands.executeMany(list);
  assert.equal(context.regulationActive,false);
  assert.equal(context.model.controls.manualHeaterKW,450);
});

test('groupe : une erreur finale est rejetée avant les effets précédents',()=>{
  const context=contextFor(E.make(),true),commands=Commands.create({getContext:()=>context});
  const before=structuredClone(context.model);
  assert.throws(()=>commands.executeMany([
    {id:'regulation.enabled',value:0},{id:'heater',value:450},{id:'rra.connect',value:1}
  ]),/RRA/);
  assert.equal(context.regulationActive,true);
  assert.deepEqual(context.model,before);
  for(const invalid of [[],null,[{id:'heater',value:400},null]])
    assert.throws(()=>commands.executeMany(invalid));
  assert.deepEqual(context.model,before);
});

test('après remplacement du modèle, aucune écriture dans l’ancienne partie',()=>{
  const old=contextFor();let current=old;
  const commands=Commands.create({getContext:()=>current});
  commands.execute({id:'heater',value:400});
  current=contextFor();
  commands.execute({id:'heater',value:700});
  assert.equal(old.model.controls.manualHeaterKW,400);
  assert.equal(current.model.controls.manualHeaterKW,700);
});

test('chargement navigateur sans DOM, réseau ni horloge',()=>{
  const context=vm.createContext({CenturionAuto:Auto});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../centurion-commands.js'),'utf8'),context);
  const local=contextFor();
  context.CenturionCommands.create({getContext:()=>local}).execute({id:'heater',value:600});
  assert.equal(local.model.controls.manualHeaterKW,600);
  assert.equal(local.model.state.time,0);
});

test('une partie indisponible est rejetée avant application',()=>{
  assert.throws(()=>Commands.create(),/contexte/);
  const commands=Commands.create({getContext:()=>null});
  assert.throws(()=>commands.execute({id:'heater',value:400}),/indisponible/);
});
