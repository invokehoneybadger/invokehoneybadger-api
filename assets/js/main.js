// Minimal mock status check (static site friendly)
(async function(){
  const el = document.getElementById('status');
  try{
    const res = await fetch('/api/v1/endpoints.json', {cache:'no-cache'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    el.textContent = `OK — v${data.version} (${data.endpoints.length} endpoints)`;
  }catch(e){
    el.textContent = 'Degraded — unable to load endpoints.json';
  }
})();