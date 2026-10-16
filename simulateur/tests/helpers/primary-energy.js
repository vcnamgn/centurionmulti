// Bilan indépendant aux frontières du CPP, hors transferts internes entre nœuds.
module.exports=(E,s,oldPressure)=>{
  const f=s.flowProperties,cp=E.C.primaryCpJkgK;
  return (s.coreTransferMW+s.pumpHeatMW-s.totalGvMW+(s.heaterKW-E.C.pzrPassiveTransferKW)/1000)*1e6
    +cp*(s.rcvDeliveredKgS*f.charge.tempC+s.risDeliveredKgS*f.ris.tempC
      -s.rcvLetdownKgS*f.letdown.tempC-s.breakLiquidKgS*f.breakLiquid.tempC
      -s.breakSteamKgS*f.breakSteam.tempC-s.reliefKgS*f.relief.tempC)
    -(s.breakSteamKgS+s.reliefSteamKgS)*E.latentHeatJkg(oldPressure);
};
