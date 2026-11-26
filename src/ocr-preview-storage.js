/* The OCR acceptance page shares the Pages host with the production app. */
const ocrPreviewPrefix = 'svocab-ocr-preview:';
const ocrPreviewStorage = window.localStorage;
function ocrPreviewKeys(){
  return Array.from({length:ocrPreviewStorage.length},(_,i)=>ocrPreviewStorage.key(i))
    .filter(key=>key?.startsWith(ocrPreviewPrefix))
    .map(key=>key.slice(ocrPreviewPrefix.length));
}
const localStorage = {
  getItem:key=>ocrPreviewStorage.getItem(ocrPreviewPrefix+key),
  setItem:(key,value)=>ocrPreviewStorage.setItem(ocrPreviewPrefix+key,value),
  removeItem:key=>ocrPreviewStorage.removeItem(ocrPreviewPrefix+key),
  key:index=>ocrPreviewKeys()[index]??null,
  get length(){ return ocrPreviewKeys().length; }
};
const indexedDB = window.indexedDB&&{
  open:(name,version)=>window.indexedDB.open(ocrPreviewPrefix+name,version)
};
