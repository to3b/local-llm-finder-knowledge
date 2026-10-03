const panels=[...document.querySelectorAll('.intent-panel')];
const links=[...document.querySelectorAll('.intent-tabs a')];
function select(){
  const chosen=location.hash==='#models'?'models':'hardware';
  for(const panel of panels)panel.hidden=panel.id!==chosen;
  for(const link of links){
    const active=link.hash==='#'+chosen;
    if(active)link.setAttribute('aria-current','true'); else link.removeAttribute('aria-current');
  }
}
links.forEach(link=>link.addEventListener('click',event=>{event.preventDefault();history.replaceState(null,'',link.hash);select();}));
window.addEventListener('hashchange',select);select();

// A saved section link should reveal its content even inside a closed topic.
function revealSection(){
  let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
  if(!id)return;
  const target=document.getElementById(id);if(!target)return;
  for(let parent=target;parent;parent=parent.parentElement){
    if(parent.tagName==='DETAILS')parent.open=true;
  }
}
window.addEventListener('hashchange',revealSection);revealSection();
