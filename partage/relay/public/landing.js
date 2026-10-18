(()=>{'use strict';const $=id=>document.getElementById(id);
  $('create').addEventListener('click',async()=>{
    $('create').disabled=true;$('status').textContent='Création de la séance…';
    try{
      const response=await fetch('/api/sessions',{method:'POST'});if(!response.ok)throw Error('Le relais ne peut pas ouvrir de séance pour le moment.');
      const session=await response.json(),master=new URL('/simulateur/centurion.html',location.href),invite=new URL('/observer',location.href);
      master.searchParams.set('shareMaster',session.sessionId);master.hash=new URLSearchParams({masterToken:session.masterToken,inviteToken:session.inviteToken}).toString();
      invite.hash=new URLSearchParams({session:session.sessionId,inviteToken:session.inviteToken}).toString();
      $('master').href=master.href;$('invitation').value=invite.href;$('session').hidden=false;
      $('status').textContent='Séance prête. Ouvre le maître pour commencer.';$('create').hidden=true;
    }catch(error){$('status').textContent=error.message;$('create').disabled=false;}
  });
  $('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('invitation').value);$('status').textContent='Invitation copiée.';}catch{$('invitation').select();$('status').textContent='Le lien est sélectionné : copie-le avec Ctrl+C.';}});
})();
