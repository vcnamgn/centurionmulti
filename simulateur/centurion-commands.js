/* Point d'entrée local des commandes. Le transport et les droits restent séparés. */
(function(root,factory){
  const Auto=typeof module==='object'&&module.exports?require('./centurion-auto.js'):root.CenturionAuto;
  const api=factory(Auto);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CenturionCommands=api;
})(typeof window!=='undefined'?window:globalThis,function(Auto){
  'use strict';
  if(!Auto)throw Error('centurion-auto.js doit être chargé avant centurion-commands.js.');

  function commandData(command){
    if(!command||typeof command!=='object'||Array.isArray(command)
      ||typeof command.id!=='string'||!Object.hasOwn(command,'value')
      ||Object.keys(command).some(key=>key!=='id'&&key!=='value'))
      throw Error('Commande attendue : {id, value}.');
    return {id:command.id,value:command.value};
  }

  // Relire le contexte à chaque appel évite de conserver un modèle remplacé
  // par un chargement ou une réinitialisation. Les règles métier restent celles
  // du catalogue existant de la conduite auto.
  function create({getContext}={}){
    if(typeof getContext!=='function')throw Error('Un fournisseur de contexte est requis.');
    function context(){
      const current=getContext();
      if(!current?.E||!current.model?.state||!current.model?.controls)
        throw Error('Contexte de simulation indisponible.');
      return current;
    }
    function validate(command){
      const data=commandData(command);
      Auto.executeCommand(context(),data.id,data.value,true);
      return data;
    }
    function execute(command){
      const data=commandData(command);
      return Auto.executeCommand(context(),data.id,data.value);
    }
    function actions(commands){
      if(!Array.isArray(commands)||!commands.length)
        throw Error('Une liste non vide de commandes est requise.');
      return commands.map(command=>{
        const data=commandData(command);
        return {type:'action',command:data.id,value:data.value};
      });
    }
    function validateMany(commands){
      const list=actions(commands);
      Auto.executeActions(context(),list,true);
    }
    function executeMany(commands){
      const list=actions(commands);
      return Auto.executeActions(context(),list);
    }
    return Object.freeze({catalog:()=>Auto.actionCatalog(),validate,execute,validateMany,executeMany});
  }
  return Object.freeze({create});
});
