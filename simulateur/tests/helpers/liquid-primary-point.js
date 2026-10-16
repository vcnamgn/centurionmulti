// Point sous-refroidi cohérent pour isoler les courbes de pompes/transits.
module.exports=(E,m,p)=>{
  const s=m.state,t=E.saturationTemperatureC(p)-30,cap=s.inventory.capacityM3;
  const vp=cap*40/E.CPP_GEOMETRY.reduce((n,g)=>n+g.volume,0),vb=cap-vp;
  const sat=E.saturationTemperatureC(p),d=E.saturatedWaterDensities(sat);
  s.primaryMassKg=vb*E.liquidWaterDensityKgM3(t,p)
    +vp*(.42*E.liquidWaterDensityKgM3(sat,p)+.58*d.vapor);
  Object.assign(s,{pressureBar:p,pzrLevelPct:42,tavgC:t,hotC:t,coldC:t,tRicC:t,
    fuelC:t+s.thermalPowerMW/E.C.coreConductanceMWC,vaporMassKg:0,vaporEnergyJ:0});
  s.primaryEnergyJ=s.primaryMassKg*E.C.primaryCpJkgK*t;s.pzrEnergyOffsetJ=0;
  E.initializePrimaryThermalState(s);
  s.boronInventory=(s.primaryMassKg-s.vaporMassKg)*s.boronPpm;
};
