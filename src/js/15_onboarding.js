/* ============ 新手引导：首次打开主动播放的分步操作引导 ============
   独立 localStorage key，只记录"已看完"，不碰任何现有数据；可随时跳过。
   触发：persona 身份弹窗选择/跳过之后（见 10i_persona.js 挂接）。 */
const ONBOARDING_KEY='english-notes-onboarding-v1';
const ONBOARDING_STEPS=[
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    title:'截图收集',
    text:'点右下角相机，从相册选字幕截图，可以一次多选。'
  },
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>',
    title:'AI 识别',
    text:'AI 自动识别图中英文，点选你要学的表达。'
  },
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    title:'整理入库',
    text:'补一句中文意思，归到笔记、加入学习，之后自动安排复习。'
  },
  {
    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    title:'复习开口',
    text:'每天先回想复习，再用情景对话练开口，把词真正用出来。'
  }
];
let _obIndex=0,_obEl=null;
function onboardingDone(){try{return localStorage.getItem(ONBOARDING_KEY)==='1';}catch(_){return false;}}
function onboardingFinish(){
  try{localStorage.setItem(ONBOARDING_KEY,'1');}catch(_){}
  if(_obEl)_obEl.classList.remove('show');
}
function onboardingRender(){
  if(!_obEl)return;
  const s=ONBOARDING_STEPS[_obIndex];
  _obEl.querySelector('#obHero').innerHTML=s.icon;
  _obEl.querySelector('#obTitle').textContent=s.title;
  _obEl.querySelector('#obText').textContent=s.text;
  _obEl.querySelector('#obDots').innerHTML=ONBOARDING_STEPS.map((_,i)=>'<span class="ob-dot'+(i===_obIndex?' active':'')+'"></span>').join('');
  _obEl.querySelector('#obBack').style.visibility=_obIndex===0?'hidden':'visible';
  _obEl.querySelector('#obNext').textContent=_obIndex===ONBOARDING_STEPS.length-1?'开始使用':'下一步';
}
function onboardingBuild(){
  const el=document.createElement('div');
  el.className='modal ob-modal';el.id='onboardingModal';
  el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','新手引导');
  el.innerHTML=
    '<div class="ob-card">'+
      '<button class="ob-skip" id="obSkip" type="button">跳过</button>'+
      '<div class="ob-hero" id="obHero"></div>'+
      '<h3 class="ob-title" id="obTitle"></h3>'+
      '<p class="ob-text" id="obText"></p>'+
      '<div class="ob-dots" id="obDots"></div>'+
      '<div class="ob-actions">'+
        '<button class="ob-back" id="obBack" type="button">上一步</button>'+
        '<button class="ob-next" id="obNext" type="button">下一步</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(el);_obEl=el;
  el.querySelector('#obSkip').onclick=onboardingFinish;
  el.querySelector('#obNext').onclick=function(){
    if(_obIndex<ONBOARDING_STEPS.length-1){_obIndex++;onboardingRender();}
    else{onboardingFinish();}
  };
  el.querySelector('#obBack').onclick=function(){if(_obIndex>0){_obIndex--;onboardingRender();}};
}
function onboardingOpen(){
  if(onboardingDone())return;
  if(!_obEl)onboardingBuild();
  _obIndex=0;onboardingRender();
  _obEl.classList.add('show');
}
function onboardingInit(){if(!_obEl)onboardingBuild();}
