const input=document.querySelector('#reference-search');
if(input) input.addEventListener('input',()=>{
  const query=input.value.trim().toLowerCase();let count=0;
  for(const row of document.querySelectorAll('[data-reference-search]')) {row.hidden=!row.dataset.referenceSearch.includes(query);if(!row.hidden) count++;}
  document.querySelector('#reference-search-status').textContent=count?`${count} matching reference${count===1?'':'s'}`:'No matching references. Try another search.';
});
