/* Compatibilité des invitations du tableau auxiliaire initial. */
(()=>{
  'use strict';const params=new URLSearchParams(location.hash.slice(1)),session=params.get('session');
  if(session&&params.get('inviteToken')){
    const url=new URL('/simulateur/centurion.html',location.href);url.searchParams.set('shareViewer',session);url.hash=params.toString();location.replace(url.href);return;
  }
  const error=new URLSearchParams(location.search).get('joinError');
  document.getElementById('connection').textContent=error==='join_rate'?'Trop de tentatives. Réessaie dans une minute.':error?'Séance introuvable ou maître absent. Vérifie les quatre chiffres.':'Saisis les quatre chiffres affichés chez le maître.';
  document.getElementById('joinForm').hidden=false;
})();
