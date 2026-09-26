// Native dialogs arrived in Safari 15.4. Older WebViews still need a modal
// backdrop, keyboard focus containment and focus restoration on close.
const fallbacks=new WeakMap();
const focusable='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function openDialog(dialog){
  if(dialog.hasAttribute('open'))return;
  if(typeof dialog.showModal==='function'){dialog.showModal();return;}
  const previous=document.activeElement,overflow=document.body.style.overflow;
  const backdrop=document.createElement('div');backdrop.className='dialog-backdrop';backdrop.setAttribute('aria-hidden','true');
  document.body.append(backdrop);document.body.style.overflow='hidden';
  dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('tabindex','-1');dialog.classList.add('dialog-fallback');
  const items=()=>Array.from(dialog.querySelectorAll(focusable)).filter(el=>el.getClientRects().length);
  const focusFirst=()=>{(items()[0]||dialog).focus();};
  const onFocus=event=>{if(!dialog.contains(event.target))focusFirst();};
  const onKey=event=>{
    if(event.key==='Escape'){event.preventDefault();closeDialog(dialog);return;}
    if(event.key!=='Tab')return;
    const elements=items(),first=elements[0],last=elements[elements.length-1];
    if(!first){event.preventDefault();dialog.focus();}
    else if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  document.addEventListener('focusin',onFocus);document.addEventListener('keydown',onKey);
  fallbacks.set(dialog,()=>{
    document.removeEventListener('focusin',onFocus);document.removeEventListener('keydown',onKey);
    backdrop.remove();dialog.removeAttribute('open');dialog.removeAttribute('aria-modal');dialog.classList.remove('dialog-fallback');document.body.style.overflow=overflow;
    if(previous?.isConnected)previous.focus();
  });
  focusFirst();
}
export function closeDialog(dialog){
  const cleanup=fallbacks.get(dialog);
  if(cleanup){fallbacks.delete(dialog);cleanup();}
  else if(typeof dialog.close==='function')dialog.close();
}
