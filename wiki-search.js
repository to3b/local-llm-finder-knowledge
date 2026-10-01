const input=document.querySelector('#reference-search');
const status=document.querySelector('#reference-status');
if(input){
  const requested=new URL(location.href).searchParams.get('status');
  if(status&&['Draft','Published'].includes(requested))status.value=requested;
  function update(){
    const query=input.value.trim().toLowerCase(),selected=status?.value||'all';
    let count=0;
    for(const row of document.querySelectorAll('[data-reference-search]')){
      row.hidden=!row.dataset.referenceSearch.includes(query)||(selected!=='all'&&row.dataset.referenceStatus!==selected);
      if(!row.hidden)count++;
    }
    for(const group of document.querySelectorAll('.reference-group')){
      const visible=group.querySelectorAll('[data-reference-search]:not([hidden])').length;
      group.hidden=!visible;
      group.querySelector('.reference-count').textContent=`(${visible})`;
    }
    document.querySelector('#reference-search-status').textContent=count?`${count} matching reference${count===1?'':'s'}`:'No matching references. Try another search or status.';
  }
  input.addEventListener('input',update);
  status?.addEventListener('change',update);
  update();
}
