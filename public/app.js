const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const state = { profile:null, plans:[], activeId:null, sessions:[], rDay:0, homeDay:null, workoutDay:null, libMusc:"todos" };
let store = null, sample = null;

/* ---------- armazenamento: db por usuário, com fallback local ---------- */
function localStore(){
  const K = "forja:";
  const rd = k => { try { return JSON.parse(localStorage.getItem(K+k)); } catch { return null; } };
  const wr = (k,v) => { try { localStorage.setItem(K+k, JSON.stringify(v)); } catch {} };
  return { kind:"local", async get(k){ return rd(k); }, async set(k,v){ wr(k,v); },
    async sessions(){ return rd("sessions") || []; }, async addSession(s){ const a = rd("sessions") || []; a.push(s); wr("sessions", a); } };
}
async function dbStore(){
  if (!window.claude?.use) return null;
  const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
  if (!db || !user) return null;
  const id = await user.id(); if (!id) return null;
  DB = db; UID = id; USERCAP = user;
  const col = db.collection("data/users/" + id);
  // Carrega todos os documentos de uma vez na abertura (uma ida ao servidor em vez de uma por documento).
  let pre = col.get().then(q => new Map(q.docs.map(d => [d.id, d.data()]))).catch(() => null);
  setTimeout(() => { pre = null; }, 20000);
  return { kind:"db", endPreload(){ pre = null; },
    async get(k){ const m = pre && await pre; if (m) return m.has(k) ? (m.get(k)?.v ?? null) : null; const s = await col.doc(k).get(); return s.exists ? s.data().v : null; },
    async set(k,v){ if (pre){ const m = await pre; m?.set(k, { v }); } await col.doc(k).set({ v }); },
    async sessions(){ const m = pre && await pre; if (m) return [...m].filter(([k]) => k.startsWith("s_")).map(([,v]) => v).sort((a,b)=>a.date.localeCompare(b.date)); const q = await col.get(); return q.docs.filter(d => d.id.startsWith("s_")).map(d => d.data()).sort((a,b)=>a.date.localeCompare(b.date)); },
    async addSession(s){ await col.doc("s_" + s.date.replace(/\D/g,"")).set(s); } };
}

/* ---------- músculos e mapa corporal ---------- */
const MUSC = { peito:"Peito", costas:"Costas", ombros:"Ombros", biceps:"Bíceps", triceps:"Tríceps", abdomen:"Abdômen", quadriceps:"Quadríceps", posterior:"Posterior", gluteos:"Glúteos", panturrilha:"Panturrilha" };
const MUSCLES = Object.keys(MUSC);
const EXTRA = { cardio:"Cardio", mobilidade:"Mobilidade" };
const VIEW = { peito:"f", biceps:"f", abdomen:"f", quadriceps:"f", ombros:"f", costas:"b", triceps:"b", gluteos:"b", posterior:"b", panturrilha:"b" };
const SHAPES = {
  f:[["ombros",'<ellipse cx="13" cy="23" rx="5" ry="4.5"/><ellipse cx="47" cy="23" rx="5" ry="4.5"/>'],
     ["peito",'<rect x="19.5" y="22" width="10" height="10" rx="3"/><rect x="30.5" y="22" width="10" height="10" rx="3"/>'],
     ["biceps",'<ellipse cx="12" cy="35" rx="3.2" ry="7"/><ellipse cx="48" cy="35" rx="3.2" ry="7"/>'],
     ["abdomen",'<rect x="24.5" y="34" width="11" height="21" rx="3"/>'],
     ["quadriceps",'<ellipse cx="23.5" cy="75" rx="4.8" ry="13"/><ellipse cx="36.5" cy="75" rx="4.8" ry="13"/>'],
     ["panturrilha",'<ellipse cx="23.5" cy="101" rx="3" ry="8"/><ellipse cx="36.5" cy="101" rx="3" ry="8"/>']],
  b:[["ombros",'<ellipse cx="13" cy="23" rx="5" ry="4.5"/><ellipse cx="47" cy="23" rx="5" ry="4.5"/>'],
     ["costas",'<path d="M19.5 22h21l-2 24q-8.5 5-17 0z"/>'],
     ["triceps",'<ellipse cx="12" cy="35" rx="3.2" ry="7"/><ellipse cx="48" cy="35" rx="3.2" ry="7"/>'],
     ["gluteos",'<ellipse cx="24" cy="62" rx="5.5" ry="5"/><ellipse cx="36" cy="62" rx="5.5" ry="5"/>'],
     ["posterior",'<ellipse cx="23.5" cy="80" rx="4.6" ry="11"/><ellipse cx="36.5" cy="80" rx="4.6" ry="11"/>'],
     ["panturrilha",'<ellipse cx="23.5" cy="101" rx="3.6" ry="8"/><ellipse cx="36.5" cy="101" rx="3.6" ry="8"/>']]
};
function bodySVG(view, fills, label){
  const sil = '<circle cx="30" cy="9" r="6.5"/><rect x="27" y="14" width="6" height="6"/><rect x="17" y="18" width="26" height="42" rx="7"/><rect x="8" y="19" width="8" height="40" rx="4"/><rect x="44" y="19" width="8" height="40" rx="4"/><rect x="18" y="57" width="11" height="58" rx="5"/><rect x="31" y="57" width="11" height="58" rx="5"/>';
  return `<svg viewBox="0 0 60 118" role="img" aria-label="${esc(label||"Mapa muscular")}"><g fill="var(--skin)">${sil}</g>` +
    SHAPES[view].map(([m,s]) => `<g fill="${fills[m] || "var(--mus)"}">${s}</g>`).join("") + `</svg>`;
}
const recColor = p => p >= 85 ? "var(--ok)" : p >= 50 ? "var(--warn)" : "var(--bad)";

/* ---------- biblioteca de exercícios ---------- */
// Lista e categorias de exercícios de hipertrofia.org (só os nomes e a organização; dicas próprias)
const CATS = { biceps:"Bíceps", triceps:"Tríceps", peito:"Peito", ombros:"Ombros", trapezio:"Trapézio", costas:"Costas", antebraco:"Antebraço", abdomen:"Abdômen", pernas:"Pernas", panturrilha:"Panturrilhas", gluteos:"Glúteos", cardio:"Cardio", mobilidade:"Mobilidade" };
// [nome, categorias, músculo principal, secundários, dificuldade 1-5, equipamento, dica]
const SITE_LIB = [
 ["Rosca direta com barra reta ou W",["biceps"],"biceps",[],2,"barra","Cotovelos parados ao lado do corpo; suba sem balançar o tronco."],
 ["Rosca simultânea",["biceps"],"biceps",[],1,"halteres","Suba os dois halteres juntos, palmas viradas para cima."],
 ["Rosca direta na polia",["biceps"],"biceps",[],2,"academia","Cotovelos fixos; o cabo mantém tensão do início ao fim."],
 ["Rosca concentrada",["biceps"],"biceps",[],1,"halteres","Sentado, cotovelo apoiado na parte de dentro da coxa."],
 ["Rosca inclinada",["biceps"],"biceps",[],2,"halteres","Banco a 45°; braços soltos atrás da linha do tronco."],
 ["Rosca spider",["biceps"],"biceps",[],2,"halteres","Peito apoiado no banco inclinado; braços pendurados à frente."],
 ["Rosca alternada",["biceps"],"biceps",[],1,"halteres","Gire o punho para cima enquanto sobe."],
 ["Barra fixa supinada (chin up)",["biceps","costas"],"costas",["biceps"],4,"barrafixa","Palmas para você; puxe até o queixo passar a barra."],
 ["Rosca scott",["biceps"],"biceps",[],2,"academia","Braço todo apoiado; desça até quase estender."],
 ["Rosca martelo",["biceps","antebraco"],"biceps",[],1,"halteres","Pegada neutra, polegar para cima."],
 ["Rosca arrastada (drag curl)",["biceps"],"biceps",[],3,"barra","A barra sobe rente ao corpo e os cotovelos vão para trás."],
 ["Rosca Zottman",["biceps","antebraco"],"biceps",[],2,"halteres","Suba com as palmas para cima e desça com as palmas para baixo."],
 ["Tríceps corda",["triceps"],"triceps",[],1,"academia","Abra a corda no final; cotovelos colados no corpo."],
 ["Tríceps francês",["triceps"],"triceps",[],2,"halteres","Halter atrás da cabeça; cotovelos apontando para cima."],
 ["Tríceps com barra reta ou W",["triceps"],"triceps",[],1,"academia","Na polia alta; só o antebraço se move."],
 ["Supino fechado",["triceps"],"triceps",["peito","ombros"],3,"barra","Mãos na largura dos ombros; cotovelos rentes ao corpo."],
 ["Tríceps invertido",["triceps"],"triceps",[],2,"academia","Pegada com as palmas para cima na polia; punhos firmes."],
 ["Paralelas",["triceps","peito"],"triceps",["peito","ombros"],4,"academia","Tronco reto foca o tríceps; inclinado à frente, o peito."],
 ["Flexão diamante",["triceps"],"triceps",["peito"],3,"corpo","Mãos juntas formando um losango sob o peito."],
 ["Tríceps banco",["triceps"],"triceps",["peito"],2,"banco","Mãos no banco atrás do corpo; desça até 90° no cotovelo."],
 ["Tríceps coice",["triceps"],"triceps",[],1,"halteres","Tronco inclinado, braço colado ao corpo; estenda para trás."],
 ["Tríceps testa",["triceps"],"triceps",[],3,"barra","A barra desce até a testa; só o cotovelo se mexe."],
 ["Supino inclinado",["peito"],"peito",["ombros","triceps"],3,"barra","Banco a 30°; a barra desce na parte alta do peito."],
 ["Supino reto",["peito"],"peito",["triceps","ombros"],3,"barra","Escápulas presas no banco; a barra desce até o meio do peito."],
 ["Supino declinado (canadense)",["peito"],"peito",["triceps"],3,"barra","Pés presos; a barra desce na parte baixa do peito."],
 ["Crucifixo",["peito"],"peito",[],2,"halteres","Cotovelos levemente dobrados; abra até alongar o peito."],
 ["Supino máquina",["peito"],"peito",["triceps"],1,"academia","Ajuste o banco para a pegada ficar na altura do peito."],
 ["Pullover com halteres",["peito"],"peito",["costas"],2,"halteres","Braços quase estendidos; desça atrás da cabeça até alongar."],
 ["Voador ou peck deck",["peito"],"peito",[],1,"academia","Cotovelos na altura dos ombros; segure 1 segundo no fim."],
 ["Flexão de braço",["peito"],"peito",["triceps","ombros"],2,"corpo","Corpo em linha reta; o peito quase encosta no chão."],
 ["Desenvolvimento com barra",["ombros"],"ombros",["triceps"],4,"barra","Glúteos contraídos; a barra passa perto do rosto."],
 ["Desenvolvimento com halteres",["ombros"],"ombros",["triceps"],3,"halteres","Não trave os cotovelos no topo; abdômen firme."],
 ["Desenvolvimento Arnold",["ombros"],"ombros",["triceps"],3,"halteres","Gire as palmas de você para a frente enquanto sobe."],
 ["Elevação lateral com halteres",["ombros"],"ombros",[],2,"halteres","Suba até a linha dos ombros, cotovelos levemente dobrados."],
 ["Elevação lateral na polia",["ombros"],"ombros",[],2,"academia","De lado para a polia; o cabo passa à frente do corpo."],
 ["Elevação frontal com halteres",["ombros"],"ombros",[],1,"halteres","Suba até a altura dos olhos sem balançar o tronco."],
 ["Elevação frontal com barra",["ombros"],"ombros",[],1,"barra","Pegada na largura dos ombros; tronco parado."],
 ["Elevação lateral inclinada",["ombros"],"ombros",[],2,"halteres","Segure num apoio e incline o corpo para o lado oposto."],
 ["Elevação lateral com cabo",["ombros"],"ombros",[],2,"academia","Um braço por vez; suba devagar até a linha do ombro."],
 ["Remada alta com barra",["ombros","trapezio"],"ombros",["costas"],2,"barra","Cotovelos sobem acima das mãos, até a linha do peito."],
 ["Remada alta com halteres",["ombros","trapezio"],"ombros",["costas"],2,"halteres","Halteres sobem rentes ao corpo, até a linha do peito."],
 ["Face pull",["ombros","trapezio"],"ombros",["costas"],2,"academia","Corda na altura do rosto; abra as mãos ao puxar."],
 ["Voador invertido",["ombros","costas"],"ombros",["costas"],1,"academia","Peito no apoio; abra os braços juntando as escápulas."],
 ["Crucifixo invertido com halteres",["ombros"],"ombros",["costas"],2,"halteres","Tronco inclinado à frente; abra os braços sem embalo."],
 ["Encolhimento",["trapezio","costas"],"costas",[],1,"halteres","Suba os ombros em direção às orelhas e segure 1 segundo."],
 ["Encolhimento por trás do corpo",["trapezio"],"costas",[],2,"barra","Barra atrás do quadril; suba os ombros sem dobrar os braços."],
 ["Levantamento terra",["trapezio"],"costas",["posterior","gluteos"],5,"barra","Barra colada nas pernas; empurre o chão com os pés."],
 ["Elevação em Y",["trapezio"],"ombros",["costas"],2,"halteres","De bruços no banco inclinado; os braços sobem formando um Y."],
 ["Depressão escapular na polia alta",["trapezio"],"costas",[],2,"academia","Braços estendidos; puxe só baixando os ombros."],
 ["Barra fixa",["costas"],"costas",["biceps"],4,"barrafixa","Comece com o braço estendido e passe o queixo da barra."],
 ["Pulley costas",["costas"],"costas",["biceps"],2,"academia","Leve a barra ao alto do peito puxando os cotovelos para baixo."],
 ["Remada curvada",["costas"],"costas",["biceps","posterior"],3,"barra","Tronco a 45°, coluna neutra, barra até o umbigo."],
 ["Remada serrote",["costas"],"costas",["biceps"],2,"halteres","Joelho e mão no banco; puxe o halter até o quadril."],
 ["Pull down",["costas"],"costas",[],2,"academia","Braços quase estendidos; leve a barra da polia até as coxas."],
 ["Remada baixa",["costas"],"costas",["biceps"],2,"academia","Peito alto; junte as escápulas no final."],
 ["Remada cavalinho",["costas"],"costas",["biceps"],3,"academia","Peito inclinado sobre a barra; puxe até o abdômen."],
 ["Rosca punho",["antebraco"],"biceps",[],1,"barra","Antebraços apoiados na coxa; só o punho se mexe."],
 ["Rosca punho invertida",["antebraco"],"biceps",[],1,"barra","Palmas para baixo; suba o dorso da mão devagar."],
 ["Suspensão na barra (dead hang)",["antebraco"],"costas",[],1,"barrafixa","Pendure-se com os braços estendidos e os ombros ativos."],
 ["Rosca inversa",["antebraco"],"biceps",[],2,"barra","Pegada com as palmas para baixo; cotovelos parados."],
 ["Rolo de punho",["antebraco"],"biceps",[],1,"academia","Braços estendidos à frente; enrole a corda girando os punhos."],
 ["Abdominal reto (tradicional)",["abdomen"],"abdomen",[],1,"corpo","Tire só as escápulas do chão; queixo longe do peito."],
 ["Abdominal na polia",["abdomen"],"abdomen",[],2,"academia","Enrole a coluna levando o peito ao quadril."],
 ["Abdominal infra nas paralelas",["abdomen"],"abdomen",[],3,"academia","Antebraços apoiados; suba os joelhos sem balançar."],
 ["Prancha abdominal",["abdomen"],"abdomen",[],1,"corpo","Quadril alinhado; contraia abdômen e glúteos."],
 ["Abdominal na máquina",["abdomen"],"abdomen",[],1,"academia","Enrole a coluna; não puxe com os braços."],
 ["Abdominal tesoura",["abdomen"],"abdomen",[],2,"corpo","Lombar no chão; cruze as pernas estendidas sem parar."],
 ["Abdominal remador",["abdomen"],"abdomen",[],2,"corpo","Abrace os joelhos ao subir e estenda tudo ao descer."],
 ["Abdominal infra no solo",["abdomen"],"abdomen",[],2,"corpo","Leve os joelhos ao peito tirando o quadril do chão."],
 ["Abdominal cruzado",["abdomen"],"abdomen",[],1,"corpo","O cotovelo vai em direção ao joelho oposto."],
 ["Roda abdominal",["abdomen"],"abdomen",["ombros"],4,"corpo","Comece de joelhos; não deixe a lombar afundar."],
 ["Abdominal declinado",["abdomen"],"abdomen",[],3,"banco","Pés presos no banco declinado; suba controlando."],
 ["Abdominal oblíquo",["abdomen"],"abdomen",[],1,"corpo","Deitado de lado; aproxime a costela do quadril."],
 ["Abdominal invertido",["abdomen"],"abdomen",[],2,"corpo","Mãos ao lado do corpo; role o quadril para cima."],
 ["Agachamento livre",["pernas","gluteos"],"quadriceps",["gluteos","posterior"],4,"barra","Joelhos na direção dos pés; desça até a coxa ficar paralela."],
 ["Agachamento frontal",["pernas"],"quadriceps",["gluteos","abdomen"],4,"barra","Barra na frente dos ombros; cotovelos altos."],
 ["Agachamento búlgaro",["pernas"],"quadriceps",["gluteos"],3,"halteres","Pé de trás no banco; peso na perna da frente."],
 ["Leg press",["pernas"],"quadriceps",["gluteos"],2,"academia","Não tire o quadril do banco nem trave os joelhos."],
 ["Agachamento hack",["pernas"],"quadriceps",["gluteos"],3,"academia","Costas apoiadas; desça controlando até 90°."],
 ["Stiff",["pernas"],"posterior",["gluteos"],2,"barra","Joelhos levemente dobrados; desça com a coluna neutra."],
 ["Levantamento terra romeno",["pernas","gluteos"],"posterior",["gluteos","costas"],3,"barra","Quadril vai para trás; a barra desliza rente às coxas."],
 ["Agachamento goblet",["pernas"],"quadriceps",["gluteos"],2,"halteres","Halter no peito; cotovelos entre os joelhos."],
 ["Afundo",["pernas"],"quadriceps",["gluteos"],2,"corpo","Joelho de trás quase toca o chão; tronco reto."],
 ["Elevação pélvica com barra",["pernas","gluteos"],"gluteos",["posterior"],3,"barra","Costas no banco; queixo no peito ao subir."],
 ["Cadeira extensora",["pernas"],"quadriceps",[],1,"academia","Segure 1 segundo com a perna estendida."],
 ["Mesa flexora",["pernas"],"posterior",[],1,"academia","Quadril colado no banco durante o movimento."],
 ["Levantamento terra sumô",["pernas"],"posterior",["gluteos","quadriceps"],4,"barra","Pés bem afastados; mãos por dentro das pernas."],
 ["Flexão nórdica",["pernas"],"posterior",[],5,"corpo","Calcanhares presos; desça o tronco bem devagar."],
 ["Good morning",["pernas"],"posterior",["gluteos","costas"],3,"barra","Barra nas costas; incline o tronco levando o quadril para trás."],
 ["Agachamento sumô",["pernas"],"gluteos",["quadriceps"],2,"halteres","Pés afastados e virados para fora; halter entre as pernas."],
 ["Elevação de panturrilhas em pé na máquina",["panturrilha"],"panturrilha",[],1,"academia","Desça abaixo do apoio e suba na ponta dos pés."],
 ["Elevação de panturrilhas no leg press",["panturrilha"],"panturrilha",[],2,"academia","Só a ponta dos pés na plataforma."],
 ["Elevação de panturrilhas em pé com o peso do corpo",["panturrilha"],"panturrilha",[],1,"corpo","Use um degrau para o calcanhar descer além do apoio."],
 ["Elevação de panturrilhas com barra livre",["panturrilha"],"panturrilha",[],2,"barra","Barra nas costas; suba e desça sem pressa."],
 ["Elevação de panturrilhas sentado na máquina",["panturrilha"],"panturrilha",[],1,"academia","Pausa de 1 segundo no alongamento."],
 ["Elevação de panturrilhas sentado com halteres",["panturrilha"],"panturrilha",[],1,"halteres","Halteres sobre os joelhos; ponta dos pés num apoio."],
 ["Passada",["gluteos"],"quadriceps",["gluteos"],2,"corpo","Passos longos à frente, alternando as pernas; tronco firme."],
 ["Extensão do quadril na polia",["gluteos"],"gluteos",["posterior"],2,"academia","Tornozeleira na polia baixa; leve a perna para trás sem arquear."]
];
// Exercícios antigos: ficam ocultos na biblioteca, mas continuam valendo para planos e histórico
const OLD_LIB = [
 ["Supino reto com barra","peito",["triceps","ombros"],3,"barra","Escápulas presas no banco; barra desce até o meio do peito."],
 ["Supino inclinado com halteres","peito",["ombros","triceps"],3,"halteres","Banco a 30°; desça os halteres até a linha do peito."],
 ["Supino com halteres no chão","peito",["triceps"],2,"halteres","Cotovelos tocam o chão de leve, sem quicar."],
 ["Supino na máquina","peito",["triceps"],1,"academia","Ajuste o banco para a pegada ficar na altura do peito."],
 ["Crucifixo na máquina","peito",[],1,"academia","Cotovelos levemente flexionados o tempo todo."],
 ["Crossover na polia","peito",["ombros"],2,"academia","Junte as mãos à frente do quadril e segure 1 segundo."],
 ["Flexão de braço","peito",["triceps","ombros"],2,"corpo","Corpo em linha reta, peito quase encosta no chão."],
 ["Flexão inclinada","peito",["triceps"],1,"corpo","Mãos num banco; quanto mais alto, mais fácil."],
 ["Mergulho nas paralelas","peito",["triceps","ombros"],4,"academia","Tronco levemente inclinado à frente para focar o peito."],
 ["Supino com elástico","peito",["triceps"],1,"elastico","Elástico preso atrás das costas; empurre até estender."],
 ["Puxada frontal","costas",["biceps"],2,"academia","Puxe a barra até o queixo levando os cotovelos para baixo."],
 ["Puxada com triângulo","costas",["biceps"],2,"academia","Tronco levemente inclinado; leve o triângulo ao peito."],
 ["Barra fixa","costas",["biceps"],4,"barrafixa","Comece do braço estendido e passe o queixo da barra."],
 ["Remada curvada com barra","costas",["biceps","posterior"],3,"barra","Tronco a 45°, coluna neutra, barra até o umbigo."],
 ["Remada unilateral com halter","costas",["biceps"],2,"halteres","Apoie joelho e mão no banco; puxe o halter até o quadril."],
 ["Remada baixa no cabo","costas",["biceps"],2,"academia","Peito alto; junte as escápulas no final."],
 ["Remada sentada na máquina","costas",["biceps"],1,"academia","Peito apoiado; puxe com os cotovelos, não com as mãos."],
 ["Remada invertida","costas",["biceps"],3,"corpo","Corpo reto sob uma mesa firme ou barra baixa."],
 ["Remada com elástico","costas",["biceps"],1,"elastico","Elástico preso na altura do peito; cotovelos rentes ao corpo."],
 ["Levantamento terra","costas",["posterior","gluteos"],5,"barra","Barra colada nas pernas; empurre o chão com os pés."],
 ["Pullover com halter","costas",["peito"],2,"halteres","Braços quase estendidos; desça até sentir alongar."],
 ["Superman","costas",["gluteos"],1,"corpo","Eleve braços e pernas juntos e segure 2 segundos."],
 ["Desenvolvimento com halteres","ombros",["triceps"],3,"halteres","Não trave os cotovelos no topo; abdômen firme."],
 ["Desenvolvimento militar com barra","ombros",["triceps"],4,"barra","Em pé, glúteos contraídos, barra passa perto do rosto."],
 ["Elevação lateral","ombros",[],2,"halteres","Suba até a linha dos ombros, cotovelos levemente dobrados."],
 ["Elevação frontal","ombros",[],1,"halteres","Suba até a altura dos olhos sem balançar o tronco."],
 ["Face pull na polia","ombros",["costas"],2,"academia","Corda na altura do rosto; abra as mãos ao puxar."],
 ["Flexão pike","ombros",["triceps"],3,"corpo","Quadril alto em V; cabeça desce entre as mãos."],
 ["Desenvolvimento com kettlebell","ombros",["triceps"],3,"kettlebell","Kettlebell apoiado no antebraço; empurre reto para cima."],
 ["Elevação lateral com elástico","ombros",[],1,"elastico","Pise no elástico e suba os braços abertos."],
 ["Rosca direta com barra","biceps",[],2,"barra","Cotovelos parados ao lado do corpo."],
 ["Rosca alternada","biceps",[],1,"halteres","Gire o punho para cima enquanto sobe."],
 ["Rosca martelo","biceps",[],1,"halteres","Pegada neutra, polegar para cima."],
 ["Rosca Scott na máquina","biceps",[],2,"academia","Desça até quase estender, sem soltar o peso."],
 ["Rosca com elástico","biceps",[],1,"elastico","Pise no elástico; suba devagar e desça em 3 segundos."],
 ["Barra fixa supinada","biceps",["costas"],4,"barrafixa","Palmas para você; puxe até o queixo passar a barra."],
 ["Tríceps na polia","triceps",[],1,"academia","Cotovelos colados no corpo; estenda tudo embaixo."],
 ["Tríceps francês","triceps",[],2,"halteres","Halter atrás da cabeça; cotovelos apontando para cima."],
 ["Tríceps testa com barra","triceps",[],3,"barra","Barra desce até a testa; só o cotovelo se mexe."],
 ["Mergulho no banco","triceps",["peito"],2,"banco","Costas perto do banco; desça até 90° no cotovelo."],
 ["Flexão diamante","triceps",["peito"],3,"corpo","Mãos juntas formando um losango sob o peito."],
 ["Tríceps coice com elástico","triceps",[],1,"elastico","Tronco inclinado; estenda o braço para trás."],
 ["Agachamento livre com barra","quadriceps",["gluteos","posterior"],4,"barra","Joelhos na direção dos pés; desça até a coxa ficar paralela."],
 ["Agachamento goblet","quadriceps",["gluteos"],2,"halteres","Segure o halter no peito; cotovelos entre os joelhos."],
 ["Agachamento com peso do corpo","quadriceps",["gluteos"],1,"corpo","Peso nos calcanhares, peito aberto."],
 ["Leg press 45°","quadriceps",["gluteos"],2,"academia","Não tire o quadril do banco nem trave os joelhos."],
 ["Cadeira extensora","quadriceps",[],1,"academia","Segure 1 segundo com a perna estendida."],
 ["Hack machine","quadriceps",["gluteos"],3,"academia","Pés no meio da plataforma; desça controlando."],
 ["Afundo alternado","quadriceps",["gluteos"],2,"corpo","Joelho de trás quase toca o chão; tronco reto."],
 ["Agachamento búlgaro","quadriceps",["gluteos"],3,"halteres","Pé de trás no banco; peso na perna da frente."],
 ["Agachamento com elástico","quadriceps",["gluteos"],1,"elastico","Elástico sob os pés e nos ombros."],
 ["Levantamento terra romeno","posterior",["gluteos","costas"],3,"barra","Quadril vai para trás; barra desliza rente às coxas."],
 ["Stiff com halteres","posterior",["gluteos"],2,"halteres","Joelhos levemente flexionados; coluna neutra."],
 ["Mesa flexora","posterior",[],1,"academia","Quadril colado no banco durante o movimento."],
 ["Cadeira flexora","posterior",[],1,"academia","Puxe até o fim e volte devagar."],
 ["Kettlebell swing","posterior",["gluteos"],3,"kettlebell","Movimento de quadril, não de braço; glúteo trava no topo."],
 ["Elevação pélvica com barra","gluteos",["posterior"],3,"barra","Costas no banco; queixo no peito ao subir."],
 ["Elevação pélvica","gluteos",["posterior"],1,"corpo","Aperte o glúteo 2 segundos no topo."],
 ["Ponte unilateral","gluteos",["posterior"],2,"corpo","Uma perna estendida; quadril alinhado."],
 ["Abdução na máquina","gluteos",[],1,"academia","Tronco levemente inclinado à frente."],
 ["Caminhada lateral com elástico","gluteos",[],1,"elastico","Elástico acima dos joelhos; passos curtos e baixos."],
 ["Agachamento sumô com halter","gluteos",["quadriceps"],2,"halteres","Pés bem afastados e virados para fora."],
 ["Panturrilha em pé","panturrilha",[],1,"corpo","Suba na ponta dos pés e desça abaixo do degrau."],
 ["Panturrilha sentado","panturrilha",[],1,"academia","Pausa de 1 segundo no alongamento."],
 ["Panturrilha no leg press","panturrilha",[],2,"academia","Só a ponta dos pés na plataforma."],
 ["Prancha","abdomen",[],1,"corpo","Quadril alinhado; contraia abdômen e glúteos."],
 ["Prancha lateral","abdomen",[],2,"corpo","Quadril alto; corpo em linha reta."],
 ["Abdominal na polia","abdomen",[],2,"academia","Enrole a coluna levando o peito ao quadril."],
 ["Abdominal bicicleta","abdomen",[],2,"corpo","Cotovelo vai ao joelho oposto, sem puxar o pescoço."],
 ["Elevação de pernas na barra","abdomen",[],4,"barrafixa","Suba as pernas sem balançar o corpo."],
 ["Hollow hold","abdomen",[],3,"corpo","Lombar colada no chão; braços e pernas estendidos."],
 ["Roda abdominal","abdomen",["ombros"],4,"corpo","Comece de joelhos; não deixe a lombar afundar."],
 ["Esteira intervalada","cardio",[],2,"cardio","30 a 60 segundos forte, 1 a 2 minutos leve."],
 ["Bike ergométrica","cardio",[],1,"cardio","Ritmo em que você ainda consegue falar frases curtas."],
 ["Burpee","cardio",["peito","quadriceps"],3,"corpo","Peito no chão e salto com braços para cima."],
 ["Polichinelo","cardio",[],1,"corpo","Ritmo constante; aterrisse na ponta dos pés."],
 ["Mountain climber","cardio",["abdomen"],2,"corpo","Quadril baixo; joelhos alternam rápido ao peito."],
 ["Pular corda","cardio",["panturrilha"],2,"corpo","Saltos baixos, giro pelos punhos."],
 ["Mobilidade de quadril 90/90","mobilidade",[],1,"corpo","Troque de lado devagar mantendo o tronco alto."],
 ["Rotação torácica","mobilidade",[],1,"corpo","De quatro apoios, gire abrindo o braço para o teto."],
 ["Alongamento de posterior","mobilidade",[],1,"corpo","Segure 30 segundos sem balançar."],
 ["Gato-camelo","mobilidade",[],1,"corpo","Alterne arredondar e arquear a coluna com a respiração."]
].map(([nome,musc,sec,nivel,equip,dica]) => ({nome,musc,sec,nivel,equip,dica}));
// Free Exercise DB (github.com/yuhonas/free-exercise-db, domínio público), traduzida e resumida para o português
const FEDB_LIB = [["Abdominal 3/4",["abdomen"],"abdomen",[],2,"corpo",["Deite com os pés presos e joelhos dobrados, mãos ao lado da cabeça.","Suba o tronco até ficar perpendicular ao chão.","Desça só três quartos do caminho e repita."],0],["Alongamento de posterior 90/90",["mobilidade"],"mobilidade",[],2,"corpo",["Deitado de costas, uma perna estendida e a outra com quadril e joelho a 90°.","Estenda a perna dobrada para o alto e segure um instante.","Volte e troque de lado."],1],["Rolo na parte interna da coxa",["mobilidade"],"mobilidade",[],3,"academia",["De bruços, apoie a parte interna de uma coxa no rolo.","Role devagar entre o quadril e o joelho.","Pare 10 a 30 segundos nos pontos mais doloridos."],4],["Alongamento de adutores com parceiro",["mobilidade"],"mobilidade",[],3,"corpo",["Deitado, pernas para o alto e abertas; o parceiro segura os tornozelos.","Tente fechar as pernas por 10 segundos enquanto ele resiste.","Relaxe e abra um pouco mais."],5],["Moinho avançado com kettlebell",["abdomen"],"abdomen",["gluteos","posterior","ombros"],3,"kettlebell",["Kettlebell travado acima da cabeça com um braço.","Leve o quadril para o lado do kettlebell e desça o tronco até a mão livre tocar o pé.","Suba mantendo o braço travado."],6],["Abdominal bicicleta no solo",["abdomen"],"abdomen",[],2,"corpo",["Deitado, lombar no chão, mãos ao lado da cabeça.","Leve um cotovelo ao joelho oposto enquanto estende a outra perna.","Alterne os lados como pedalando."],7],["Alongamento de quadríceps em quatro apoios",["mobilidade"],"mobilidade",[],3,"corpo",["De quatro, levante uma perna e segure o pé com a mão.","Puxe o calcanhar em direção ao glúteo.","Segure e troque de lado."],8],["Rosca martelo alternada",["biceps"],"biceps",[],1,"halteres",["Em pé, halteres ao lado do corpo com palmas viradas para dentro.","Suba um halter de cada vez sem mexer o cotovelo.","Desça devagar e alterne."],9],["Toque no calcanhar alternado",["abdomen"],"abdomen",[],1,"corpo",["Deitado, joelhos dobrados e pés afastados, braços ao lado do corpo.","Tire os ombros do chão e incline o tronco para tocar um calcanhar.","Alterne os lados."],10],["Rosca inclinada alternada",["biceps"],"biceps",[],1,"halteres",["Sentado no banco inclinado, halteres pendurados.","Suba um halter de cada vez girando a palma para cima.","Desça devagar e alterne."],11],["Salto diagonal alternado",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"corpo",["Um pé levemente à frente do outro.","Impulsione com a perna da frente e salte na diagonal, levando o joelho oposto para cima.","Aterrisse na outra perna e continue."],12],["Desenvolvimento alternado na polia",["ombros"],"ombros",["triceps"],2,"academia",["Cabos na parte baixa, alças na altura dos ombros.","Empurre um braço de cada vez para cima até estender.","Desça devagar e alterne."],13],["Elevação frontal alternada",["ombros"],"ombros",[],1,"halteres",["Em pé, halteres ao lado do corpo.","Suba um halter à frente até a altura do ombro, cotovelo levemente dobrado.","Desça e alterne."],14],["Supino no chão alternado com kettlebell",["peito"],"peito",["abdomen","ombros","triceps"],2,"kettlebell",["Deitado no chão, um kettlebell em cada mão sobre o peito.","Empurre um braço de cada vez até estender.","Desça devagar e alterne."],15],["Hang clean alternado com kettlebell",["pernas"],"posterior",["biceps","panturrilha","gluteos"],3,"kettlebell",["Dois kettlebells entre os pés, quadril para trás.","Leve um kettlebell até o ombro com impulso do quadril.","Desça e alterne os braços."],16],["Desenvolvimento alternado com kettlebell",["ombros"],"ombros",["triceps"],3,"kettlebell",["Leve dois kettlebells aos ombros.","Empurre um de cada vez para cima até travar o braço.","Desça e alterne."],17],["Remada alternada com kettlebell",["costas"],"costas",["biceps"],3,"kettlebell",["Kettlebells à frente dos pés, joelhos levemente dobrados e quadril para trás.","Puxe um kettlebell até a lateral do abdômen.","Desça e alterne."],18],["Remada renegada alternada",["costas"],"costas",["abdomen","biceps","peito"],5,"kettlebell",["Em posição de flexão, mãos sobre dois kettlebells.","Puxe um kettlebell até o quadril sem girar o corpo.","Volte e alterne."],19],["Círculos com o tornozelo",["mobilidade"],"mobilidade",[],1,"corpo",["Apoie-se num suporte e tire um pé do chão.","Faça círculos com a ponta do pé, para um lado e para o outro.","Troque de perna."],20],["Alongamento tornozelo sobre o joelho",["mobilidade"],"mobilidade",[],2,"corpo",["Deitado, joelhos dobrados; cruze um tornozelo sobre o joelho oposto.","Puxe a coxa de baixo em direção ao peito.","Segure e troque de lado."],21],["Liberação da canela com rolo",["mobilidade"],"mobilidade",[],3,"academia",["Sentado, joelhos dobrados.","Passe um rolo de massagem na parte de fora da canela.","Pare nos pontos mais sensíveis."],22],["Remada antigravidade com barra",["ombros"],"ombros",["costas","triceps"],2,"barra",["Deitado de bruços no banco inclinado, barra no chão.","Puxe a barra e estenda os braços à frente acima da cabeça.","Volte devagar."],23],["Círculos com os braços",["mobilidade"],"mobilidade",[],1,"corpo",["Em pé, braços abertos na altura dos ombros.","Faça círculos pequenos aumentando aos poucos.","Inverta o sentido."],24],["Volta ao mundo com halteres",["peito"],"peito",["ombros"],3,"halteres",["Deitado no banco, halteres junto às coxas com palmas para cima.","Leve os braços abertos num semicírculo até acima da cabeça.","Volte pelo mesmo caminho."],26],["Treino de pedra Atlas",["costas"],"costas",["biceps","gluteos","posterior"],3,"academia",["Barra curta carregada no chão entre os pés.","Agache e abrace a carga, subindo até ficar em pé.","Desça controlando."],27],["Pedras Atlas",["costas"],"costas",["abdomen","quadriceps","biceps"],5,"academia",["Pedra entre os pés; abrace-a com os dedos por baixo.","Levante até o colo e depois estenda o quadril para colocá-la na plataforma.","Volte ao chão com cuidado."],28],["Levantamento terra com eixo grosso",["costas"],"costas",["biceps","gluteos","posterior"],3,"academia",["Barra grossa sobre o meio dos pés, pés na largura do quadril.","Segure na largura dos ombros, costas retas, e suba estendendo quadril e joelhos.","Desça controlando."],29],["Crucifixo invertido com elástico",["ombros"],"ombros",["costas","triceps"],2,"elastico",["Elástico preso num poste na altura do peito.","Abra os braços para os lados juntando as escápulas.","Volte devagar."],30],["Arrasto de trenó para trás",["pernas"],"quadriceps",["panturrilha","biceps","gluteos"],2,"academia",["Trenó carregado com corda ou alças.","Ande para trás puxando o trenó, tronco inclinado.","Mantenha passos curtos e firmes."],31],["Arremesso de medicine ball para trás",["ombros"],"ombros",[],2,"academia",["Em pé, de costas para o alvo, bola nas mãos.","Agache e lance a bola para trás por cima da cabeça, estendendo o corpo.","Recupere e repita."],32],["Prancha de equilíbrio",["panturrilha"],"panturrilha",["posterior","quadriceps"],2,"academia",["Suba na prancha de equilíbrio.","Mantenha-se equilibrado pelo tempo desejado."],33],["Flexão de pernas na bola",["pernas"],"posterior",["panturrilha","gluteos"],1,"academia",["Deitado de costas, calcanhares sobre a bola.","Eleve o quadril e puxe a bola em direção ao glúteo dobrando os joelhos.","Estenda devagar."],34],["Barra fixa com elástico",["costas"],"costas",["abdomen","biceps"],2,"academia",["Prenda o elástico na barra e apoie um joelho ou pé nele.","Puxe até o queixo passar da barra.","Desça devagar."],35],["Bom dia com elástico",["pernas"],"posterior",["gluteos","costas"],2,"elastico",["Pise no elástico e passe a outra ponta atrás do pescoço.","Incline o tronco à frente com pernas quase retas.","Volte estendendo o quadril."],36],["Puxada entre as pernas com elástico",["pernas"],"posterior",["gluteos","costas"],2,"elastico",["Elástico preso num poste atrás de você, passado entre as pernas.","Incline o quadril para trás e depois estenda contraindo os glúteos.","Mantenha a coluna neutra."],37],["Adução de quadril com elástico",["pernas"],"quadriceps",[],1,"elastico",["Elástico preso no tornozelo de dentro, de lado para o poste.","Traga a perna para dentro cruzando à frente da outra.","Volte devagar e troque de lado."],38],["Abertura com elástico (pull apart)",["ombros"],"ombros",["costas"],1,"elastico",["Braços estendidos à frente segurando o elástico.","Abra os braços até o elástico tocar o peito.","Volte devagar."],39],["Tríceps testa com elástico",["triceps"],"triceps",[],1,"elastico",["Deitado no banco, elástico preso atrás da cabeça.","Estenda os cotovelos mantendo os braços parados.","Volte devagar."],40],["Rollout com barra em pé",["abdomen"],"abdomen",["costas","ombros"],3,"barra",["Em posição de flexão, mãos numa barra com anilhas leves.","Role a barra à frente alongando o corpo.","Puxe de volta com o abdômen."],41],["Rollout com barra de joelhos",["abdomen"],"abdomen",["costas","ombros"],5,"barra",["De joelhos, mãos numa barra com anilhas leves.","Role à frente até quase encostar o peito no chão.","Volte contraindo o abdômen."],42],["Rosca com barra no banco inclinado",["biceps"],"biceps",[],1,"barra",["Deitado de bruços no banco inclinado, barra pendurada.","Suba a barra mantendo os braços parados.","Desça devagar."],45],["Agachamento completo com barra",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra apoiada nas costas, pés na largura dos ombros.","Desça o mais fundo que conseguir com o tronco firme.","Suba empurrando o chão."],47],["Ponte de glúteo com barra",["gluteos"],"gluteos",["panturrilha","posterior"],3,"barra",["Deitado de costas, barra sobre o quadril e joelhos dobrados.","Suba o quadril contraindo os glúteos.","Desça devagar."],48],["Supino guilhotina",["peito"],"peito",["ombros","triceps"],3,"barra",["Deitado no banco, barra com pegada média.","Desça a barra em direção ao pescoço, cotovelos abertos.","Empurre de volta. Use carga leve e um ajudante."],49],["Agachamento hack com barra",["pernas"],"quadriceps",["panturrilha","biceps","posterior"],3,"barra",["Em pé, barra atrás das pernas com braços estendidos.","Agache até as coxas ficarem paralelas ao chão.","Suba empurrando com os calcanhares."],50],["Elevação de ombros no banco inclinado",["ombros"],"ombros",["peito"],2,"barra",["Deitado no inclinado, barra estendida acima do peito.","Suba a barra só afastando os ombros do banco, sem dobrar os cotovelos.","Volte devagar."],53],["Afundo com barra",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra nas costas, em pé.","Dê um passo à frente e desça até o joelho de trás quase tocar o chão.","Volte e troque de perna."],54],["Remada para deltoide posterior com barra",["ombros"],"ombros",["biceps","costas"],2,"barra",["Tronco inclinado, barra com pegada aberta.","Puxe a barra em direção ao peito com os cotovelos abertos.","Desça devagar."],55],["Rollout com barra a partir do banco",["abdomen"],"abdomen",["gluteos","posterior","costas"],3,"barra",["Joelhos no banco, mãos na barra no chão.","Role a barra à frente alongando o corpo.","Volte com o abdômen."],56],["Panturrilha sentado com barra",["panturrilha"],"panturrilha",[],1,"barra",["Sentado, ponta dos pés num bloco, barra sobre as coxas.","Suba os calcanhares o máximo possível.","Desça alongando."],57],["Desenvolvimento com barra sentado",["ombros"],"ombros",["peito","triceps"],3,"barra",["Sentado no banco com encosto, barra na altura dos ombros.","Empurre a barra para cima até estender.","Desça até a altura do queixo."],58],["Encolhimento com barra",["trapezio"],"costas",[],1,"barra",["Em pé, barra à frente das coxas.","Suba os ombros em direção às orelhas.","Segure um instante e desça."],59],["Flexão lateral com barra",["abdomen"],"abdomen",["costas"],1,"barra",["Barra nas costas, pés na largura dos ombros.","Incline o tronco para um lado e volte.","Alterne os lados."],61],["Agachamento lateral com barra",["pernas"],"quadriceps",["panturrilha","posterior","costas"],2,"barra",["Barra nas costas, pés bem afastados.","Desça flexionando um joelho e mantendo a outra perna estendida.","Volte e troque de lado."],62],["Agachamento com barra até o banco",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Banco atrás de você, barra nas costas.","Desça até encostar levemente no banco.","Suba sem relaxar."],64],["Subida no banco com barra",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra nas costas, de frente para um banco.","Suba com uma perna e traga a outra.","Desça e alterne."],65],["Afundo andando com barra",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"barra",["Barra nas costas.","Dê passos à frente descendo até o joelho de trás quase tocar o chão.","Continue alternando as pernas."],66],["Cordas navais",["ombros"],"ombros",["peito","biceps"],2,"academia",["Segure uma ponta da corda em cada mão.","Faça ondas rápidas alternando ou juntando os braços.","Mantenha joelhos levemente dobrados."],67],["Arrasto de trenó engatinhando",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"academia",["Trenó preso à cintura, mãos e pés no chão.","Engatinhe para a frente puxando o trenó.","Mantenha o quadril baixo."],68],["Alongamento de peito com mãos atrás da cabeça",["mobilidade"],"mobilidade",[],5,"academia",["Sentado, mãos atrás da cabeça.","Leve os cotovelos para trás; o parceiro ajuda segurando.","Segure de 10 a 30 segundos."],69],["Salto sobre o banco",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"corpo",["De frente para um banco baixo.","Agache, balance os braços e salte sobre ele.","Aterrisse suave e repita."],71],["Supino de powerlifting",["triceps"],"triceps",["peito","biceps","costas"],3,"barra",["Deitado com arco nas costas e pés firmes.","Desça a barra até o peito.","Empurre de forma explosiva."],72],["Supino com elástico",["peito"],"peito",["ombros","triceps"],2,"elastico",["Elástico preso no banco e passado pelas costas.","Empurre as alças até estender os braços.","Volte devagar."],73],["Supino com correntes",["triceps"],"triceps",["peito","costas","ombros"],5,"barra",["Correntes presas na barra.","Desça a barra até o peito.","Empurre até estender; a carga aumenta no alto."],74],["Sprint no banco",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"academia",["Um pé sobre o banco.","Troque os pés rapidamente, empurrando com o de cima.","Mantenha ritmo forte."],75],["Pullover com barra e braços dobrados",["costas"],"costas",["peito","ombros","triceps"],3,"barra",["Deitado no banco, barra acima do peito com braços dobrados.","Leve a barra para trás da cabeça até alongar.","Volte à posição inicial."],76],["Pullover com halter e braços dobrados",["peito"],"peito",["costas","ombros","triceps"],3,"halteres",["Deitado atravessado no banco, halter acima do peito.","Leve o halter para trás da cabeça com cotovelos dobrados.","Volte devagar."],77],["Elevação de quadril com joelhos dobrados",["abdomen"],"abdomen",[],2,"corpo",["Deitado, joelhos dobrados e pés fora do chão.","Suba o quadril usando o abdômen inferior.","Desça devagar."],78],["Crucifixo invertido com cabeça apoiada",["ombros"],"ombros",[],1,"halteres",["Tronco inclinado, testa apoiada num banco inclinado.","Abra os braços para os lados com halteres.","Desça devagar."],80],["Elevação lateral curvado na polia",["ombros"],"ombros",["costas"],1,"academia",["Tronco paralelo ao chão, alça da polia baixa na mão.","Abra o braço para o lado até a altura do ombro.","Volte devagar."],81],["Remada unilateral com barra T",["costas"],"costas",["biceps"],2,"barra",["Barra presa num canto, carga numa ponta.","Puxe a ponta da barra com uma mão até o abdômen.","Desça e troque de lado."],82],["Remada com barra T",["costas"],"costas",["biceps"],3,"barra",["Barra presa num canto, carga numa ponta.","Puxe com as duas mãos até o peito.","Desça devagar."],83],["Remada curvada com halteres",["costas"],"costas",["biceps","ombros"],2,"halteres",["Tronco inclinado, halter em cada mão.","Puxe os halteres até a lateral do abdômen.","Desça devagar."],84],["Remada curvada com halteres pegada neutra",["costas"],"costas",["biceps"],2,"halteres",["Tronco inclinado, palmas viradas uma para a outra.","Puxe os halteres junto ao corpo.","Desça devagar."],85],["Desenvolvimento curvado com kettlebell",["abdomen"],"abdomen",["gluteos","posterior","costas"],5,"kettlebell",["Kettlebell no ombro.","Incline o tronco para o lado oposto enquanto estende o braço.","Fique em pé com o braço travado."],86],["Ciclismo",["cardio"],"cardio",[],2,"academia",["Ajuste o banco à sua altura.","Pedale no ritmo desejado."],87],["Bicicleta ergométrica",["cardio"],"cardio",[],2,"academia",["Ajuste o banco e escolha o programa.","Pedale no ritmo e na carga desejados."],88],["Supino com tábuas",["triceps"],"triceps",["peito","biceps","costas"],3,"barra",["Tábuas sobre o peito.","Desça a barra até tocar as tábuas.","Empurre até estender."],89],["Prancha com extensão de braços",["triceps"],"triceps",["abdomen","biceps"],3,"corpo",["Prancha nos antebraços.","Estenda os braços passando para as mãos.","Volte aos antebraços."],90],["Tríceps com peso do corpo na barra",["triceps"],"triceps",[],1,"corpo",["Barra na altura do peito, corpo inclinado segurando-a.","Dobre os cotovelos levando a testa à barra.","Estenda os braços."],91],["Crucifixo com peso do corpo",["peito"],"peito",["abdomen","ombros","triceps"],3,"barra",["Mãos sobre duas barras que rolam, em posição de flexão.","Abra os braços deixando o peito descer.","Junte de volta."],92],["Remada com peso do corpo na barra fixa",["costas"],"costas",["biceps"],3,"academia",["Pendurado na barra com joelhos no peito, corpo inclinado para trás.","Puxe o corpo até a barra.","Desça devagar."],93],["Agachamento com peso do corpo",["pernas"],"quadriceps",["gluteos","posterior"],2,"corpo",["Pés na largura dos ombros, mãos atrás da cabeça.","Desça levando o quadril para trás.","Suba empurrando os calcanhares."],94],["Abdominal na polia com Bosu e flexão lateral",["abdomen"],"abdomen",[],1,"academia",["Sobre o Bosu, alças da polia baixa nas mãos.","Faça o abdominal e incline para um lado.","Alterne os lados."],96],["Clean de cabeça para baixo com kettlebell",["antebraco"],"biceps",["ombros"],3,"kettlebell",["Kettlebell numa mão.","Balance e leve-o ao ombro com a base para cima.","Aperte a alça para equilibrar."],97],["Elevação de quadril invertida (bottoms up)",["abdomen"],"abdomen",[],2,"corpo",["Deitado, pernas retas.","Leve os joelhos ao peito e suba o quadril.","Desça devagar."],98],["Salto na caixa (repetido)",["pernas"],"posterior",["gluteos","quadriceps","panturrilha"],2,"academia",["De frente para a caixa.","Salte em cima dela usando os braços.","Desça e repita em sequência."],99],["Salto entre caixas",["pernas"],"posterior",["gluteos","quadriceps","panturrilha"],2,"academia",["Caixas enfileiradas.","Salte de uma perna para cima da primeira caixa.","Continue alternando as pernas."],100],["Agachamento no caixote",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra nas costas, caixote atrás.","Sente no caixote sem relaxar.","Suba de forma explosiva."],101],["Agachamento no caixote com elástico",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],5,"barra",["Elásticos presos à barra.","Sente no caixote controlando.","Suba de forma explosiva."],102],["Agachamento no caixote com correntes",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],5,"barra",["Correntes presas à barra.","Sente no caixote controlando.","Suba de forma explosiva."],103],["Liberação do braquial com rolo",["mobilidade"],"mobilidade",[],3,"academia",["Deitado de lado, braço sobre o rolo.","Role ao longo da parte de fora do braço.","Pare nos pontos sensíveis."],104],["Desenvolvimento Bradford",["ombros"],"ombros",["triceps"],2,"barra",["Sentado, barra na altura dos ombros.","Suba a barra por cima da cabeça e desça atrás dela.","Volte passando para a frente."],105],["Elevação de quadril em prancha",["abdomen"],"abdomen",[],2,"corpo",["Prancha nos antebraços.","Suba o quadril formando um V invertido.","Volte à prancha."],106],["Ponte de glúteo",["gluteos"],"gluteos",["posterior"],1,"corpo",["Deitado de costas, joelhos dobrados.","Suba o quadril empurrando com os calcanhares.","Desça devagar."],107],["Supino na polia sentado",["peito"],"peito",["ombros","triceps"],2,"academia",["Sentado, alças na altura do peito.","Empurre à frente até estender os braços.","Volte devagar."],109],["Crossover na polia",["peito"],"peito",["ombros"],1,"academia",["Polias no alto, uma alça em cada mão.","Junte as mãos à frente do quadril com cotovelos levemente dobrados.","Volte devagar."],110],["Levantamento terra na polia",["pernas"],"quadriceps",["biceps","gluteos","posterior"],2,"academia",["Cabos na parte baixa, alças nas mãos.","Suba estendendo quadril e joelhos.","Desça controlando."],112],["Rosca martelo na polia com corda",["biceps"],"biceps",[],1,"academia",["Corda na polia baixa, palmas viradas para dentro.","Suba sem mexer os cotovelos.","Desça devagar."],113],["Adução de quadril na polia",["pernas"],"quadriceps",[],1,"academia",["Tornozeleira na polia baixa, perna de dentro presa.","Traga a perna para dentro cruzando à frente.","Volte devagar."],114],["Tríceps na polia deitado no inclinado",["costas"],"costas",[],1,"academia",["Deitado no inclinado, barra da polia alta acima da cabeça.","Estenda os braços à frente.","Volte devagar."],115],["Extensão de tríceps na polia no inclinado",["triceps"],"triceps",[],1,"academia",["Deitado no inclinado, barra da polia acima da cabeça.","Estenda os cotovelos mantendo os braços parados.","Volte devagar."],116],["Rotação interna na polia",["ombros"],"ombros",[],2,"academia",["Sentado de lado para a polia baixa.","Gire o antebraço em direção ao abdômen com o cotovelo colado.","Volte devagar."],117],["Cruz de ferro na polia",["peito"],"peito",[],1,"academia",["Polias no alto, braços abertos.","Desça os braços até as coxas mantendo-os estendidos.","Volte devagar."],118],["Rotação de tronco na polia (judo flip)",["abdomen"],"abdomen",[],2,"academia",["De lado para a polia baixa, corda nas duas mãos.","Gire o tronco puxando a corda na diagonal para cima.","Volte devagar."],119],["Tríceps na polia deitado",["triceps"],"triceps",[],1,"academia",["Deitado no banco, barra da polia baixa com pegada fechada acima da testa.","Estenda os cotovelos sem mexer os braços.","Volte devagar."],120],["Tríceps unilateral na polia",["triceps"],"triceps",[],1,"academia",["Alça da polia alta numa mão, palma para cima.","Estenda o cotovelo até o braço ficar reto.","Volte devagar e troque de lado."],121],["Rosca scott na polia",["biceps"],"biceps",[],1,"academia",["Banco scott à frente da polia baixa, barra reta.","Suba a barra com os braços apoiados.","Desça devagar."],122],["Crucifixo invertido na polia",["ombros"],"ombros",[],1,"academia",["Polias acima da cabeça, cabos cruzados à frente.","Abra os braços para trás na altura dos ombros.","Volte devagar."],123],["Abdominal invertido na polia",["abdomen"],"abdomen",[],1,"academia",["Tornozeleira na polia baixa, deitado de frente para ela.","Leve os joelhos ao peito tirando o quadril do chão.","Volte devagar."],124],["Tríceps francês na polia com corda",["triceps"],"triceps",[],1,"academia",["Corda na polia baixa, de costas para ela, braços acima da cabeça.","Estenda os cotovelos.","Volte devagar."],125],["Remada alta para deltoide posterior na polia",["ombros"],"ombros",["biceps","costas"],2,"academia",["Sentado na remada baixa com corda.","Puxe a corda em direção ao rosto com cotovelos altos.","Volte devagar."],126],["Rotação russa na polia",["abdomen"],"abdomen",[],2,"academia",["Deitado na bola, alça da polia média nas mãos.","Gire o tronco para o lado oposto à polia.","Volte devagar e troque de lado."],127],["Abdominal sentado na polia",["abdomen"],"abdomen",[],1,"academia",["Sentado de costas para a polia alta, corda junto ao pescoço.","Enrole o tronco à frente.","Volte devagar."],128],["Elevação lateral sentado na polia",["ombros"],"ombros",["costas"],1,"academia",["Sentado entre duas polias baixas, cabos cruzados.","Abra os braços até a altura dos ombros.","Desça devagar."],129],["Desenvolvimento na polia em pé",["ombros"],"ombros",["triceps"],2,"academia",["Entre duas polias baixas, alças nos ombros.","Empurre para cima até estender.","Desça devagar."],130],["Encolhimento na polia",["trapezio"],"costas",[],1,"academia",["Barra da polia baixa à frente do corpo.","Suba os ombros em direção às orelhas.","Desça devagar."],131],["Rosca de punho na polia",["antebraco"],"biceps",[],1,"academia",["Sentado, antebraços nas coxas, barra da polia baixa nas mãos.","Suba só os punhos.","Desça devagar."],132],["Encolhimento na máquina de panturrilha",["trapezio"],"costas",[],1,"academia",["Ombros sob os apoios da máquina de panturrilha.","Suba os ombros sem dobrar os braços.","Desça devagar."],133],["Panturrilha na máquina sentado (calf press)",["panturrilha"],"panturrilha",[],1,"academia",["Ponta dos pés na plataforma, joelhos quase retos.","Empurre com a ponta dos pés.","Volte alongando."],134],["Panturrilha sobre halter",["panturrilha"],"panturrilha",[],3,"halteres",["Segure num apoio e fique com a ponta dos pés sobre o cabo de um halter.","Suba na ponta dos pés.","Desça devagar."],136],["Panturrilha com elástico",["panturrilha"],"panturrilha",[],1,"elastico",["Pise no elástico com a ponta dos pés, alças nas mãos.","Suba na ponta dos pés.","Desça devagar."],137],["Alongamento de panturrilha com cotovelos na parede",["mobilidade"],"mobilidade",[],1,"corpo",["De frente para a parede, antebraços apoiados nela.","Afaste os pés mantendo calcanhares no chão.","Segure de 20 a 30 segundos."],138],["Alongamento de panturrilha com mãos na parede",["mobilidade"],"mobilidade",[],1,"corpo",["Mãos na parede, um pé à frente.","Incline o corpo com o calcanhar de trás no chão.","Segure e troque de lado."],139],["Liberação da panturrilha com rolo",["mobilidade"],"mobilidade",[],3,"academia",["Sentado, rolo sob a panturrilha.","Role do tornozelo ao joelho.","Pare nos pontos sensíveis."],140],["Levantamento terra de carro",["pernas"],"quadriceps",["biceps","gluteos","posterior"],3,"academia",["Alças do aparelho ao lado do corpo.","Suba estendendo quadril e joelhos.","Desça controlando."],141],["Volante com anilha",["ombros"],"ombros",["biceps"],1,"barra",["Em pé, anilha à frente com braços estendidos.","Gire a anilha para um lado e para o outro como um volante."],142],["Passo carioca rápido",["pernas"],"quadriceps",["abdomen","gluteos","panturrilha"],2,"corpo",["Pés próximos, postura atlética.","Cruze os pés rapidamente andando de lado.","Volte para o outro lado."],143],["Alongamento do gato",["mobilidade"],"mobilidade",[],2,"corpo",["De quatro, arredonde as costas contraindo o abdômen.","Segure alguns segundos e relaxe."],144],["Arremesso por cima da cabeça",["costas"],"costas",["abdomen","peito","ombros"],2,"academia",["De frente para a parede, bola atrás da cabeça.","Lance a bola com força usando o tronco.","Pegue e repita."],145],["Tríceps com correntes",["triceps"],"triceps",[],3,"academia",["Correntes presas a alças, deitado no banco.","Estenda os cotovelos levantando as correntes.","Desça devagar."],146],["Supino com correntes nas alças",["peito"],"peito",["ombros","triceps"],3,"academia",["Deitado no banco, correntes presas às alças.","Empurre para cima até estender.","Desça devagar."],147],["Alongamento de perna na cadeira",["mobilidade"],"mobilidade",[],1,"academia",["Sentado, segure a cadeira.","Estenda uma perna puxando a ponta do pé.","Segure e troque de lado."],148],["Alongamento lateral na cadeira",["mobilidade"],"mobilidade",[],1,"corpo",["Sentado, incline o tronco para um lado com o braço acima da cabeça.","Segure e troque de lado."],149],["Agachamento até a cadeira",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"academia",["Barra nas costas, cadeira atrás.","Desça até encostar na cadeira.","Suba sem relaxar."],150],["Alongamento de tronco na cadeira",["mobilidade"],"mobilidade",[],2,"academia",["Sentado na ponta, segure o encosto.","Estique os braços e puxe o tronco à frente.","Segure."],151],["Alongamento de peito e ombros com bastão",["mobilidade"],"mobilidade",[],1,"academia",["Segure um bastão à frente com pegada aberta.","Leve-o por cima da cabeça até atrás das costas.","Volte devagar."],152],["Arremesso de peito em três apoios",["peito"],"peito",["abdomen","ombros","triceps"],2,"academia",["Agachado com uma mão no chão, bola junto ao peito.","Lance a bola à frente explodindo com as pernas."],153],["Arremesso de peito ajoelhado (repetido)",["peito"],"peito",["abdomen","ombros","triceps"],2,"academia",["Ajoelhado de frente para a parede, bola no peito.","Lance e receba seguidamente."],154],["Arremesso de peito ajoelhado",["peito"],"peito",["abdomen","ombros","triceps"],2,"academia",["Ajoelhado, bola no peito.","Lance à frente o mais longe possível."],155],["Arremesso de peito com corrida",["peito"],"peito",["abdomen","ombros","triceps"],2,"academia",["Postura atlética, bola perto das pernas.","Lance a bola à frente e saia correndo."],156],["Alongamento de peito na bola",["mobilidade"],"mobilidade",[],1,"academia",["De quatro ao lado da bola, cotovelo sobre ela.","Desça o tronco até sentir o peito alongar.","Troque de lado."],157],["Postura da criança",["mobilidade"],"mobilidade",[],2,"corpo",["De quatro, leve as mãos à frente.","Sente sobre os calcanhares com braços estendidos.","Relaxe e respire."],158],["Alongamento queixo no peito",["mobilidade"],"mobilidade",[],2,"corpo",["Sentado, mãos atrás da cabeça.","Puxe levemente o queixo em direção ao peito.","Segure."],160],["Circus bell",["ombros"],"ombros",["biceps","gluteos","posterior"],5,"academia",["Halter gigante entre os pés.","Leve ao ombro e empurre acima da cabeça com um braço.","Desça com cuidado."],161],["Clean (arremesso ao ombro)",["pernas"],"posterior",["panturrilha","biceps","gluteos"],3,"barra",["Barra no chão, pegada fora das pernas.","Puxe explosivamente e receba a barra nos ombros agachando.","Fique em pé."],162],["Levantamento terra de clean",["pernas"],"posterior",["biceps","gluteos","costas"],2,"barra",["Barra perto das canelas, pés na largura do quadril.","Suba a barra até o meio das coxas com costas retas.","Desça controlando."],163],["Puxada de clean",["pernas"],"quadriceps",["biceps","gluteos","posterior"],3,"barra",["Barra no chão, pegada fora das pernas.","Puxe explosivamente estendendo quadril e subindo os ombros.","Desça controlando."],164],["Encolhimento de clean",["trapezio"],"costas",["biceps","ombros"],2,"barra",["Barra no meio das coxas.","Estenda o quadril e suba os ombros de forma explosiva.","Volte."],165],["Arremesso (clean and jerk)",["ombros"],"ombros",["abdomen","gluteos","posterior"],5,"barra",["Faça o clean levando a barra aos ombros.","Depois empurre a barra acima da cabeça com afundo das pernas.","Junte os pés e desça a barra."],166],["Clean e desenvolvimento",["ombros"],"ombros",["abdomen","panturrilha","gluteos"],3,"barra",["Leve a barra do chão aos ombros.","Empurre acima da cabeça.","Desça com controle."],167],["Clean a partir de blocos",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra sobre blocos.","Puxe explosivamente e receba nos ombros.","Fique em pé."],168],["Flexão relógio",["peito"],"peito",["ombros","triceps"],3,"corpo",["Em posição de flexão.","Faça uma flexão e mova as mãos um pouco para o lado, girando como um relógio.","Continue até dar a volta."],169],["Supino fechado com halter",["triceps"],"triceps",["peito","ombros"],2,"halteres",["Deitado, um halter segurado com as duas mãos sobre o peito.","Desça até o peito e empurre de volta."],171],["Rosca com barra W e elástico",["biceps"],"biceps",[],1,"barra",["Elástico preso nas pontas da barra W, pés sobre ele.","Suba a barra com pegada fechada.","Desça devagar."],172],["Supino fechado com barra W",["triceps"],"triceps",["peito","ombros"],2,"barra",["Deitado, barra W com pegada fechada.","Desça até o peito e empurre."],173],["Rosca com barra W pegada fechada",["biceps"],"biceps",[],1,"barra",["Em pé, barra W na pegada interna.","Suba sem mexer os cotovelos.","Desça devagar."],174],["Puxada frontal pegada fechada",["costas"],"costas",["biceps","ombros"],2,"academia",["Sentado na puxada, pegada fechada na barra.","Puxe até o alto do peito.","Volte devagar."],175],["Flexão fechada sobre halter",["triceps"],"triceps",["abdomen","peito","ombros"],3,"corpo",["Mãos sobre um halter em pé, corpo reto.","Desça o peito até o halter.","Empurre de volta."],176],["Rosca direta com barra pegada fechada",["biceps"],"biceps",[],1,"barra",["Em pé, mãos próximas na barra.","Suba sem mexer os cotovelos.","Desça devagar."],177],["Roda de Conan",["pernas"],"quadriceps",["abdomen","biceps","panturrilha"],3,"academia",["Carga presa na ponta do implemento, segurada no cotovelo.","Ande em círculo pelo tempo ou distância."],179],["Rosca martelo cruzada",["biceps"],"biceps",[],1,"halteres",["Em pé, halteres com palmas para dentro.","Suba o halter cruzando à frente do corpo até o ombro oposto.","Alterne."],182],["Crossover com elástico",["peito"],"peito",["biceps","ombros"],2,"elastico",["Elástico preso num poste atrás de você.","Junte as mãos à frente do peito.","Volte devagar."],183],["Afundo reverso cruzado",["mobilidade"],"mobilidade",[],3,"corpo",["Em pé.","Dê um passo para trás cruzando atrás da outra perna e desça.","Volte e alterne."],184],["Crucifixo estático (strongman)",["ombros"],"ombros",["biceps"],1,"academia",["Segure pesos com os braços abertos ao lado do corpo.","Mantenha pelo maior tempo possível."],185],["Abdominal com mãos acima da cabeça",["abdomen"],"abdomen",[],1,"corpo",["Deitado, joelhos dobrados, braços estendidos acima da cabeça.","Suba o tronco mantendo os braços alinhados.","Desça devagar."],186],["Abdominal com pernas na bola",["abdomen"],"abdomen",[],1,"corpo",["Deitado, pés sobre a bola com joelhos a 90°.","Tire os ombros do chão.","Desça devagar."],187],["Desenvolvimento cubano",["ombros"],"ombros",["costas"],3,"halteres",["Halteres com braços paralelos ao chão.","Gire os antebraços para cima e depois empurre acima da cabeça.","Volte pelo mesmo caminho."],189],["Alongamento do dançarino",["mobilidade"],"mobilidade",[],2,"corpo",["Sentado, cruze uma perna dobrada sobre a outra.","Gire o tronco em direção ao joelho dobrado.","Troque de lado."],190],["Inseto morto (dead bug)",["abdomen"],"abdomen",[],2,"corpo",["Deitado, braços para o teto e quadril e joelhos a 90°.","Estenda um braço e a perna oposta.","Volte e alterne."],191],["Levantamento terra com elástico",["costas"],"costas",["biceps","gluteos","posterior"],5,"barra",["Elásticos presos na barra.","Suba estendendo quadril e joelhos.","Desça controlando."],192],["Levantamento terra com correntes",["costas"],"costas",["biceps","gluteos","posterior"],5,"barra",["Correntes na barra.","Suba estendendo quadril e joelhos.","Desça controlando."],193],["Supino declinado fechado com tríceps testa",["triceps"],"triceps",["peito","ombros"],3,"barra",["No declinado, barra com pegada fechada.","Faça um supino e depois um tríceps testa.","Alterne os movimentos."],195],["Supino declinado com halteres",["peito"],"peito",["ombros","triceps"],2,"halteres",["No declinado, halteres acima do peito.","Desça até a lateral do peito.","Empurre de volta."],197],["Crucifixo declinado com halteres",["peito"],"peito",[],2,"halteres",["No declinado, halteres acima do peito.","Abra os braços com cotovelos levemente dobrados.","Junte de volta."],198],["Tríceps declinado com halteres",["triceps"],"triceps",[],1,"halteres",["No declinado, halteres acima do peito.","Dobre os cotovelos levando os halteres para trás da cabeça.","Estenda."],199],["Tríceps testa declinado com barra W",["triceps"],"triceps",[],1,"barra",["No declinado, barra W com pegada fechada.","Desça a barra até a testa.","Estenda os cotovelos."],200],["Abdominal oblíquo declinado",["abdomen"],"abdomen",[],2,"corpo",["No declinado, tronco elevado.","Gire o tronco levando o cotovelo ao joelho oposto.","Alterne."],201],["Flexão declinada",["peito"],"peito",["ombros","triceps"],2,"corpo",["Mãos no chão e pés num banco.","Desça o peito até perto do chão.","Empurre de volta."],202],["Abdominal invertido declinado",["abdomen"],"abdomen",[],2,"corpo",["Deitado no declinado, segure o topo do banco.","Leve os joelhos ao peito tirando o quadril.","Desça devagar."],203],["Supino declinado no Smith",["peito"],"peito",["ombros","triceps"],2,"academia",["Banco declinado sob o Smith.","Desça a barra até a parte baixa do peito.","Empurre de volta."],204],["Levantamento terra com déficit",["costas"],"costas",["biceps","gluteos","posterior"],3,"barra",["Em pé sobre uma anilha ou plataforma baixa.","Faça o levantamento terra a partir dessa posição mais baixa."],205],["Salto em profundidade",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["De pé sobre uma caixa baixa.","Desça e salte imediatamente para uma caixa mais alta."],206],["Paralelas na máquina",["triceps"],"triceps",["peito","ombros"],2,"academia",["Sentado na máquina, cotovelos junto ao corpo.","Empurre as alças para baixo até estender.","Volte devagar."],207],["Paralelas para peito",["peito"],"peito",["ombros","triceps"],3,"academia",["Nas paralelas, tronco inclinado à frente.","Desça dobrando os cotovelos.","Suba empurrando."],208],["Paralelas para tríceps",["triceps"],"triceps",["peito","ombros"],2,"corpo",["Nas paralelas, tronco reto.","Desça até 90° nos cotovelos.","Suba empurrando."],209],["Panturrilha burrinho",["panturrilha"],"panturrilha",[],3,"academia",["Quadril sob o apoio, tronco inclinado.","Suba na ponta dos pés.","Desça alongando."],210],["Hang clean alternado com dois kettlebells",["pernas"],"posterior",["biceps","panturrilha","gluteos"],3,"kettlebell",["Dois kettlebells entre os pés.","Leve um ao ombro enquanto o outro desce.","Alterne."],211],["Arremesso com dois kettlebells",["ombros"],"ombros",["panturrilha","quadriceps","triceps"],3,"kettlebell",["Kettlebells nos ombros.","Dê um impulso com as pernas e trave os braços acima da cabeça.","Desça aos ombros."],212],["Push press com dois kettlebells",["ombros"],"ombros",["panturrilha","quadriceps","triceps"],3,"kettlebell",["Kettlebells nos ombros.","Agache um pouco e empurre usando o impulso das pernas.","Desça aos ombros."],213],["Snatch com dois kettlebells",["ombros"],"ombros",["gluteos","posterior","quadriceps"],5,"kettlebell",["Kettlebells atrás dos pés.","Balance e leve-os acima da cabeça num só movimento.","Desça com controle."],214],["Moinho com dois kettlebells",["abdomen"],"abdomen",["gluteos","posterior","ombros"],3,"kettlebell",["Um kettlebell acima da cabeça e outro no chão.","Desça o tronco até pegar o de baixo mantendo o de cima travado.","Suba."],215],["Salto chutando o glúteo",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"corpo",["Em pé, joelhos levemente dobrados.","Salte levando os calcanhares ao glúteo.","Aterrisse suave e repita."],216],["Equilíbrio de bruços na bola",["gluteos"],"gluteos",["abdomen","posterior"],3,"academia",["De bruços na bola, ande com as mãos à frente.","Fique com as pernas sobre a bola e o corpo reto.","Segure."],217],["Flexão com queda entre caixas",["peito"],"peito",["ombros","triceps"],3,"academia",["Mãos sobre caixas baixas.","Solte as mãos para o chão e faça uma flexão explosiva de volta às caixas."],219],["Supino reto com halteres",["peito"],"peito",["ombros","triceps"],2,"halteres",["Deitado no banco, halteres acima do peito.","Desça até a lateral do peito.","Empurre até estender."],221],["Supino com halteres pegada neutra",["peito"],"peito",["ombros","triceps"],2,"halteres",["Deitado, palmas viradas uma para a outra.","Desça os halteres junto ao peito.","Empurre de volta."],222],["Clean com halteres",["pernas"],"posterior",["panturrilha","biceps","gluteos"],3,"halteres",["Halteres ao lado do corpo.","Desça até perto do chão e leve-os aos ombros com impulso do quadril.","Desça e repita."],224],["Supino no chão com halteres",["triceps"],"triceps",["peito","ombros"],3,"halteres",["Deitado no chão, halteres acima do peito.","Desça até os cotovelos tocarem o chão.","Empurre de volta."],225],["Remada no banco inclinado com halteres",["costas"],"costas",["biceps","ombros"],2,"halteres",["Peito apoiado no banco inclinado, halteres pendurados.","Puxe até a lateral do tronco.","Desça devagar."],227],["Elevação de ombros no inclinado com halteres",["ombros"],"ombros",["triceps"],1,"halteres",["No inclinado, halteres estendidos acima.","Suba os halteres afastando os ombros do banco.","Volte devagar."],228],["Crucifixo invertido unilateral deitado",["ombros"],"ombros",["costas"],3,"halteres",["De bruços num banco pouco inclinado, halter numa mão.","Abra o braço para o lado.","Desça devagar e troque."],230],["Pronação de punho deitado com halter",["antebraco"],"biceps",[],3,"halteres",["Antebraço apoiado no banco, halter na mão.","Gire o punho para baixo.","Volte devagar."],231],["Crucifixo invertido deitado com halteres",["ombros"],"ombros",[],3,"halteres",["De bruços num banco pouco inclinado.","Abra os braços para os lados.","Desça devagar."],232],["Supinação de punho deitado com halter",["antebraco"],"biceps",[],3,"halteres",["Antebraço apoiado, halter na mão.","Gire o punho para cima.","Volte devagar."],233],["Desenvolvimento unilateral com halter",["ombros"],"ombros",["triceps"],3,"halteres",["Sentado com encosto, halter no ombro.","Empurre para cima até estender.","Desça e troque."],234],["Tríceps francês unilateral com halter",["triceps"],"triceps",[],3,"halteres",["Sentado, halter acima da cabeça.","Desça atrás da cabeça dobrando o cotovelo.","Estenda."],235],["Remada alta unilateral com halter",["ombros"],"ombros",["biceps","costas"],3,"halteres",["Em pé, halter à frente das coxas.","Puxe até o peito com o cotovelo alto.","Desça e troque."],236],["Rosca de bruços no inclinado",["biceps"],"biceps",[],3,"halteres",["De bruços no inclinado, halteres pendurados.","Suba os halteres.","Desça devagar."],237],["Elevação com halteres",["ombros"],"ombros",["biceps"],2,"halteres",["Em pé, halteres ao lado.","Suba os braços à frente e para cima.","Desça devagar."],238],["Afundo reverso com halteres",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"halteres",["Halteres ao lado do corpo.","Dê um passo para trás e desça.","Volte e alterne."],239],["Salto na caixa sentado com halter",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"halteres",["Sentado no banco com halter no peito, caixa ao lado.","Levante explosivamente e salte na caixa."],241],["Flexão lateral com halter",["abdomen"],"abdomen",[],1,"halteres",["Halter numa mão.","Incline o tronco para o lado do halter e volte.","Troque de lado."],245],["Agachamento com halteres",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"halteres",["Halteres ao lado das pernas.","Desça até as coxas ficarem paralelas.","Suba."],246],["Agachamento com halteres até o banco",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"halteres",["Banco atrás, halteres ao lado.","Desça até encostar no banco.","Suba."],247],["Subida no banco com halteres",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"halteres",["Halteres ao lado, um pé no banco.","Suba estendendo a perna de cima.","Desça e alterne."],248],["Tríceps testa com halteres pegada pronada",["triceps"],"triceps",[],1,"halteres",["Deitado, halteres acima dos ombros.","Desça dobrando os cotovelos.","Estenda."],249],["Alongamento dinâmico de costas",["mobilidade"],"mobilidade",[],2,"corpo",["Em pé, braços retos.","Balance os braços para cima e para baixo.","Repita várias vezes."],250],["Alongamento dinâmico de peito",["mobilidade"],"mobilidade",[],2,"corpo",["Braços estendidos à frente.","Abra os braços para trás rapidamente.","Volte e repita."],251],["Rosca com barra W",["biceps"],"biceps",[],1,"barra",["Em pé, barra W na pegada externa.","Suba sem mexer os cotovelos.","Desça devagar."],252],["Círculos com os cotovelos",["mobilidade"],"mobilidade",[],1,"corpo",["Mãos nos ombros, cotovelos para os lados.","Faça círculos com os cotovelos.","Inverta o sentido."],254],["Cotovelo no joelho",["abdomen"],"abdomen",[],2,"corpo",["Deitado, uma perna cruzada sobre o joelho dobrado.","Leve o cotovelo oposto ao joelho.","Troque."],255],["Cotovelos para trás",["mobilidade"],"mobilidade",[],1,"corpo",["Mãos na lombar, cotovelos para os lados.","Puxe os cotovelos para trás.","Segure."],256],["Afundo reverso elevado com barra",["pernas"],"quadriceps",["gluteos","posterior"],3,"barra",["Barra nas costas, em pé sobre plataforma baixa.","Dê um passo para trás e desça.","Volte e alterne."],257],["Remada baixa elevada",["costas"],"costas",[],3,"academia",["Em pé numa plataforma na remada baixa.","Puxe a alça até o abdômen.","Volte devagar."],258],["Elíptico",["cardio"],"cardio",[],3,"academia",["Suba no aparelho e escolha o programa.","Pedale num ritmo constante."],259],["Abdominal na bola",["abdomen"],"abdomen",[],1,"academia",["Lombar apoiada na bola, pés no chão.","Tire o tronco da bola contraindo o abdômen.","Volte devagar."],260],["Puxada de joelhos na bola",["abdomen"],"abdomen",[],2,"academia",["Mãos no chão, canelas sobre a bola.","Puxe os joelhos ao peito rolando a bola.","Estenda."],261],["Supino unilateral no chão com kettlebell",["peito"],"peito",["ombros","triceps"],2,"kettlebell",["Deitado no chão, kettlebell numa mão.","Empurre para cima.","Desça e troque."],262],["Rotação externa deitado com halter",["ombros"],"ombros",[],1,"halteres",["Deitado de lado, cotovelo colado.","Gire o antebraço para cima.","Volte devagar."],263],["Rotação externa com elástico",["ombros"],"ombros",[],2,"elastico",["Elástico na altura do cotovelo.","Gire o antebraço para fora com o cotovelo colado.","Volte."],264],["Rotação externa na polia",["ombros"],"ombros",[],1,"academia",["Polia na altura do cotovelo.","Gire o antebraço para fora com o cotovelo colado.","Volte."],265],["Caminhada do fazendeiro",["antebraco"],"biceps",["abdomen","gluteos","posterior"],3,"academia",["Pesos pesados nas mãos.","Ande com passos curtos e tronco firme."],267],["Skipping rápido",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"corpo",["Postura relaxada.","Faça saltitos rápidos alternando as pernas."],268],["Rosca de dedos com barra",["antebraco"],"biceps",[],1,"barra",["Sentado, barra nas mãos com palmas para cima.","Deixe a barra rolar até os dedos e feche as mãos.","Repita."],269],["Crucifixo na polia no banco reto",["peito"],"peito",[],3,"academia",["Banco reto entre duas polias baixas.","Junte as alças acima do peito.","Volte devagar."],270],["Puxada de pernas no banco",["abdomen"],"abdomen",[],2,"corpo",["Deitado, pernas fora do banco.","Leve os joelhos ao peito.","Estenda devagar."],271],["Elevação de pernas deitado no banco",["abdomen"],"abdomen",[],1,"corpo",["Deitado, pernas retas fora do banco.","Suba as pernas até 90°.","Desça devagar."],272],["Rosca inclinada com halter descentralizado",["biceps"],"biceps",[],1,"halteres",["No inclinado, segure o halter mais de um lado.","Suba girando o punho.","Desça devagar."],273],["Flexão nórdica no chão",["pernas"],"posterior",["panturrilha","gluteos"],3,"corpo",["De joelhos com os pés presos.","Desça o tronco devagar.","Volte com o posterior."],274],["Supino no chão com barra",["triceps"],"triceps",["peito","ombros"],3,"barra",["Deitado no chão sob a barra.","Desça até os cotovelos tocarem o chão.","Empurre."],275],["Supino no chão com correntes",["triceps"],"triceps",["peito","ombros"],3,"barra",["Deitado no chão, correntes na barra.","Desça até os cotovelos tocarem o chão.","Empurre."],276],["Batida de pernas de bruços",["gluteos"],"gluteos",["posterior"],2,"corpo",["De bruços no banco, quadril na borda.","Alterne as pernas para cima e para baixo."],277],["Liberação do pé com rolo",["mobilidade"],"mobilidade",[],3,"academia",["Sentado, sem tênis.","Role a sola do pé num rolo ou bola."],278],["Arrasto de trenó com desenvolvimento",["peito"],"peito",["panturrilha","gluteos","posterior"],3,"academia",["Trenó preso atrás, alças nas mãos.","Ande para a frente empurrando as alças à frente."],279],["Agachamento Frankenstein",["pernas"],"quadriceps",["abdomen","panturrilha","gluteos"],3,"barra",["Barra na frente dos ombros, braços estendidos à frente.","Agache mantendo a barra no lugar.","Suba."],280],["Agachamento com salto",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"corpo",["Braços cruzados no peito.","Agache e salte o mais alto possível.","Aterrisse suave."],281],["Salto do sapo",["mobilidade"],"mobilidade",[],3,"corpo",["Mãos atrás da cabeça, agachado.","Salte à frente e aterrisse agachado.","Repita."],282],["Abdominal borboleta",["abdomen"],"abdomen",[],3,"corpo",["Deitado, solas dos pés juntas e joelhos abertos.","Suba o tronco.","Desça devagar."],283],["Agachamento frontal até o banco",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Barra na frente dos ombros, banco atrás.","Desça até encostar.","Suba."],285],["Salto frontal na caixa",["pernas"],"posterior",["gluteos","quadriceps","panturrilha"],2,"academia",["Caixa à frente.","Agache e salte em cima dela.","Desça e repita."],286],["Elevação frontal na polia",["ombros"],"ombros",[],1,"academia",["Alça da polia baixa numa mão.","Suba o braço à frente até o ombro.","Desça e troque."],287],["Saltos sobre cones",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Cones enfileirados.","Salte sobre eles seguidamente com os pés juntos."],288],["Elevação frontal no inclinado",["ombros"],"ombros",[],1,"halteres",["Sentado no inclinado, halteres pendurados.","Suba os braços à frente.","Desça devagar."],290],["Balanço frontal de perna",["mobilidade"],"mobilidade",[],2,"corpo",["Segure num apoio.","Balance a perna reta para a frente e para trás.","Troque."],291],["Elevação frontal com anilha",["ombros"],"ombros",[],3,"academia",["Anilha nas mãos.","Suba à frente até a altura dos olhos.","Desça devagar."],292],["Elevação frontal com pullover",["peito"],"peito",["costas","ombros","triceps"],2,"barra",["Deitado, barra sobre as coxas.","Suba a barra por cima da cabeça até alongar.","Volte."],293],["Agachamento frontal (pegada de clean)",["pernas"],"quadriceps",["abdomen","gluteos","posterior"],3,"barra",["Barra nos ombros com pegada de clean.","Agache até as coxas paralelas.","Suba."],294],["Agachamento frontal com dois kettlebells",["pernas"],"quadriceps",["panturrilha","gluteos"],3,"kettlebell",["Kettlebells nos ombros.","Agache até as coxas paralelas.","Suba."],295],["Elevação frontal com dois halteres",["ombros"],"ombros",[],1,"halteres",["Halteres à frente das coxas.","Suba os dois juntos até a altura do ombro.","Desça."],296],["Puxada com amplitude total",["costas"],"costas",["biceps","ombros"],3,"academia",["Alças da polia alta cruzadas.","Puxe até a lateral do peito.","Volte alongando."],297],["Barra fixa até o esterno (Gironda)",["costas"],"costas",["biceps"],3,"academia",["Pegada supinada, peito para fora.","Puxe até o esterno tocar a barra.","Desça."],298],["Glúteo-posterior na máquina (GHR)",["pernas"],"posterior",["panturrilha","gluteos"],3,"academia",["Pés presos na máquina.","Desça o tronco e suba usando posterior e glúteos."],299],["Coice de glúteo",["gluteos"],"gluteos",["posterior"],2,"corpo",["De quatro.","Leve uma perna para trás e para cima.","Volte e troque."],300],["Bom dia a partir dos pinos",["pernas"],"posterior",["abdomen","gluteos","costas"],3,"barra",["Barra nos pinos na altura do abdômen.","Encaixe sob a barra inclinado e suba.","Volte aos pinos."],303],["Barra fixa com abdominal (gorila)",["abdomen"],"abdomen",["biceps","costas"],3,"corpo",["Pendurado com pegada supinada.","Suba o corpo e os joelhos ao mesmo tempo.","Desça."],304],["Alongamento de virilha e costas",["mobilidade"],"mobilidade",[],3,"corpo",["Sentado, solas juntas, mãos atrás da cabeça.","Curve o tronco para baixo.","Segure."],305],["Groiners",["mobilidade"],"mobilidade",[],3,"corpo",["Em posição de flexão.","Salte levando os pés ao lado das mãos.","Volte."],306],["Supino inclinado com halteres pegada neutra",["peito"],"peito",["ombros","triceps"],2,"halteres",["No inclinado, palmas viradas uma para a outra.","Desça e empurre."],309],["Liberação do posterior com rolo",["mobilidade"],"mobilidade",[],1,"academia",["Sentado, rolo sob o posterior da coxa.","Role do quadril ao joelho."],310],["Alongamento de posterior",["mobilidade"],"mobilidade",[],1,"corpo",["Deitado, uma perna estendida para cima.","Puxe a perna em sua direção.","Segure e troque."],311],["Flexão em parada de mão",["ombros"],"ombros",["triceps"],5,"corpo",["De costas para a parede, em parada de mão.","Desça a cabeça perto do chão.","Empurre de volta."],312],["Hang clean",["pernas"],"quadriceps",["panturrilha","biceps","gluteos"],3,"barra",["Barra no meio das coxas.","Puxe explosivamente e receba nos ombros.","Fique em pé."],313],["Hang clean abaixo dos joelhos",["pernas"],"quadriceps",["panturrilha","biceps","gluteos"],3,"barra",["Barra logo abaixo dos joelhos.","Puxe explosivamente e receba nos ombros."],314],["Hang snatch",["pernas"],"posterior",["abdomen","panturrilha","biceps"],5,"barra",["Pegada aberta, barra nas coxas.","Leve a barra acima da cabeça num só movimento.","Fique em pé."],315],["Hang snatch abaixo dos joelhos",["pernas"],"posterior",["abdomen","panturrilha","biceps"],5,"barra",["Barra abaixo dos joelhos.","Leve acima da cabeça num só movimento."],316],["Bom dia com barra suspensa",["pernas"],"posterior",["abdomen","gluteos","costas"],3,"barra",["Barra suspensa na altura do abdômen.","Encaixe sob a barra e suba.","Volte."],317],["Elevação de pernas na barra",["abdomen"],"abdomen",[],5,"corpo",["Pendurado na barra.","Suba as pernas até o quadril.","Desça devagar."],318],["Pike pendurado",["abdomen"],"abdomen",[],5,"corpo",["Pendurado na barra, pernas juntas.","Suba as pernas retas até a barra.","Desça."],319],["Equilíbrio de snatch",["pernas"],"quadriceps",["abdomen","biceps","gluteos"],3,"barra",["Barra leve nas costas.","Empurre e caia num agachamento com a barra acima da cabeça."],320],["Golpe no saco de pancada",["peito"],"peito",["abdomen","ombros","triceps"],2,"academia",["Ao lado do saco, pés afastados.","Empurre o saco com força usando o corpo todo."],321],["Rosca na polia alta",["biceps"],"biceps",[],3,"academia",["Entre duas polias altas, braços abertos.","Leve as mãos em direção à cabeça.","Volte."],322],["Círculos de quadril em quatro apoios",["mobilidade"],"mobilidade",[],1,"corpo",["De quatro.","Faça círculos com um joelho dobrado.","Troque."],323],["Extensão de quadril com elástico",["gluteos"],"gluteos",["posterior"],2,"elastico",["Elástico no tornozelo, de frente para o poste.","Leve a perna para trás.","Volte e troque."],324],["Flexão de quadril com elástico",["pernas"],"quadriceps",[],2,"elastico",["Elástico no tornozelo, de costas para o poste.","Leve a perna à frente.","Volte e troque."],325],["Elevação de quadril com elástico",["gluteos"],"gluteos",["panturrilha","posterior"],2,"elastico",["Deitado com elástico sobre o quadril.","Suba o quadril.","Desça."],326],["Abraço na bola",["mobilidade"],"mobilidade",[],1,"academia",["Sentado com a bola entre as pernas.","Abrace a bola e desça o quadril.","Segure."],327],["Abraço dos joelhos",["mobilidade"],"mobilidade",[],2,"corpo",["Deitado, puxe os joelhos ao peito.","Segure por baixo dos joelhos."],328],["Saltos sobre barreiras",["pernas"],"posterior",["gluteos","quadriceps","panturrilha"],2,"academia",["Barreiras enfileiradas.","Salte sobre elas seguidamente."],329],["Hiperextensão lombar",["costas"],"costas",["gluteos","posterior"],1,"academia",["No banco de hiperextensão, tornozelos presos.","Desça o tronco e suba até alinhar.","Volte."],330],["Hiperextensão no banco reto",["costas"],"costas",["gluteos","posterior"],3,"corpo",["Alguém segura as pernas, tronco fora do banco.","Desça e suba até alinhar."],331],["Alongamento de trato iliotibial e glúteo",["mobilidade"],"mobilidade",[],3,"academia",["Faixa no pé, leve a perna cruzando o corpo.","Segure e troque."],332],["Liberação do trato iliotibial com rolo",["mobilidade"],"mobilidade",[],3,"academia",["De lado, rolo sob a coxa.","Role do quadril ao joelho."],333],["Lagarta (inchworm)",["mobilidade"],"mobilidade",[],2,"corpo",["Mãos no chão à frente dos pés.","Ande com as mãos até a prancha e volte com os pés."],334],["Tríceps testa com barra no inclinado",["triceps"],"triceps",["biceps"],3,"barra",["No inclinado, barra acima da cabeça.","Desça atrás da cabeça.","Estenda."],335],["Remada no inclinado com halteres",["costas"],"costas",["ombros"],1,"barra",["De bruços no inclinado.","Puxe os halteres até o tronco.","Desça."],336],["Supino inclinado na polia",["peito"],"peito",["ombros","triceps"],2,"academia",["Sentado, alças na altura do peito.","Empurre para cima e para a frente.","Volte."],337],["Crucifixo inclinado na polia",["peito"],"peito",["ombros"],3,"academia",["Banco inclinado entre polias baixas.","Junte as alças acima do peito.","Volte devagar."],338],["Supino inclinado com halteres palmas para dentro",["peito"],"peito",["ombros","triceps"],2,"halteres",["No inclinado, palmas para dentro.","Desça e empurre."],339],["Crucifixo inclinado com halteres",["peito"],"peito",["ombros"],2,"halteres",["No inclinado, halteres acima do peito.","Abra os braços com cotovelos levemente dobrados.","Junte de volta."],341],["Crucifixo inclinado com giro",["peito"],"peito",["ombros"],2,"halteres",["No inclinado, halteres acima do peito.","Abra os braços e gire os punhos ao subir.","Junte de volta."],342],["Supino inclinado com halteres",["peito"],"peito",["ombros","triceps"],2,"halteres",["No inclinado, halteres sobre o peito.","Desça até a parte alta do peito.","Empurre de volta."],343],["Rosca martelo no inclinado",["biceps"],"biceps",[],1,"halteres",["Sentado no inclinado, palmas para dentro.","Suba os halteres.","Desça devagar."],344],["Rosca inclinada aberta",["biceps"],"biceps",[],1,"halteres",["No inclinado, braços levemente abertos.","Suba os halteres para fora.","Desça devagar."],345],["Flexão inclinada",["peito"],"peito",["ombros","triceps"],2,"corpo",["Mãos num banco.","Desça o peito até o banco.","Empurre de volta."],346],["Flexão inclinada fechada",["triceps"],"triceps",["peito","ombros"],2,"corpo",["Mãos próximas numa barra ou banco.","Desça o peito.","Empurre."],347],["Flexão inclinada com salto",["peito"],"peito",["ombros","triceps"],2,"academia",["Mãos na caixa.","Solte as mãos para os colchonetes e empurre de volta à caixa."],348],["Flexão inclinada média",["peito"],"peito",["abdomen","ombros","triceps"],2,"corpo",["Mãos na largura dos ombros numa barra ou banco.","Desça e empurre."],349],["Flexão inclinada pegada invertida",["peito"],"peito",["abdomen","ombros","triceps"],2,"corpo",["Mãos na barra com palmas para cima.","Desça e empurre."],350],["Flexão inclinada aberta",["peito"],"peito",["abdomen","ombros","triceps"],2,"corpo",["Mãos bem abertas numa barra ou banco.","Desça e empurre."],351],["Alongamento intermediário de virilha",["mobilidade"],"mobilidade",[],3,"academia",["Deitado, faixa num pé.","Leve a perna estendida para o lado.","Segure e troque."],352],["Alongamento de flexor do quadril e quadríceps",["mobilidade"],"mobilidade",[],3,"academia",["De bruços, faixa no pé.","Puxe o calcanhar ao glúteo.","Segure e troque."],353],["Rotação interna com elástico",["ombros"],"ombros",[],1,"elastico",["Elástico na altura do cotovelo.","Gire o antebraço para dentro com o cotovelo colado.","Volte."],354],["Remada invertida",["costas"],"costas",[],2,"corpo",["Barra na altura da cintura, corpo reto sob ela.","Puxe o peito até a barra.","Desça devagar."],355],["Remada invertida com fitas",["costas"],"costas",["biceps"],2,"academia",["Fitas suspensas, corpo inclinado para trás.","Puxe o peito até as mãos.","Desça."],356],["Cruz de ferro com halteres",["ombros"],"ombros",["peito","gluteos","posterior"],3,"halteres",["Em pé, halteres ao lado.","Suba um braço à frente e o outro para o lado.","Alterne."],357],["Cruz de ferro (alongamento)",["mobilidade"],"mobilidade",[],3,"corpo",["De bruços, braços abertos.","Leve uma perna por cima do corpo até o lado oposto.","Troque."],358],["Contração isométrica de peito",["peito"],"peito",["ombros","triceps"],2,"corpo",["Palmas juntas à frente do peito.","Aperte uma mão contra a outra.","Segure."],359],["Isometria de pescoço frente e trás",["trapezio"],"costas",[],1,"corpo",["Mão na testa.","Empurre a cabeça contra a mão sem mexer.","Repita atrás."],360],["Isometria de pescoço lateral",["trapezio"],"costas",[],1,"corpo",["Mão na lateral da cabeça.","Empurre a cabeça contra a mão.","Troque de lado."],361],["Limpador isométrico",["peito"],"peito",["abdomen","ombros","triceps"],2,"corpo",["Em posição de flexão.","Leve o peso do corpo de um braço para o outro."],362],["JM press",["triceps"],"triceps",["peito","ombros"],2,"barra",["Deitado, barra com pegada fechada.","Desça a barra em direção ao queixo dobrando os cotovelos.","Empurre."],363],["Abdominal canivete",["abdomen"],"abdomen",[],2,"corpo",["Deitado, braços acima da cabeça.","Suba pernas e tronco ao mesmo tempo.","Desça."],364],["Abdominal Janda",["abdomen"],"abdomen",[],1,"corpo",["Joelhos dobrados, glúteos contraídos.","Suba o tronco devagar.","Desça."],365],["Agachamento Jefferson",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra entre as pernas.","Agache e suba segurando a barra.","Desça."],366],["Equilíbrio de arremesso",["ombros"],"ombros",["gluteos","posterior","quadriceps"],3,"barra",["Barra nos ombros.","Dê um passo à frente empurrando a barra para cima."],367],["Agachamento curto de arremesso",["pernas"],"quadriceps",["abdomen","panturrilha"],3,"barra",["Barra na posição de arremesso.","Desça um pouco e suba rápido."],368],["Trote na esteira",["cardio"],"cardio",[],2,"academia",["Suba na esteira e escolha a velocidade.","Corra num ritmo confortável."],369],["Carregamento de barril",["costas"],"costas",["abdomen","biceps","panturrilha"],3,"academia",["Barril a alguns metros.","Leve até a plataforma e volte para o próximo."],370],["Desenvolvimento Arnold com kettlebell",["ombros"],"ombros",["triceps"],3,"kettlebell",["Kettlebell no ombro.","Empurre para cima girando o punho.","Desça."],371],["Dead clean com kettlebell",["pernas"],"posterior",["panturrilha","gluteos","costas"],3,"kettlebell",["Kettlebell entre os pés.","Leve ao ombro do chão.","Desça."],372],["Oito com kettlebell",["abdomen"],"abdomen",["posterior","ombros"],3,"kettlebell",["Kettlebell entre as pernas.","Passe em formato de oito entre as pernas."],373],["Halo com kettlebell",["ombros"],"ombros",["costas","abdomen","triceps"],2,"kettlebell",["Kettlebell de cabeça para baixo à frente.","Gire em volta da cabeça.","Inverta."],-1],["Halo com extensão acima da cabeça",["ombros"],"ombros",["triceps","costas","abdomen"],3,"kettlebell",["Gire o kettlebell em volta da cabeça.","Depois estenda os braços para cima."],-1],["Hang clean com kettlebell",["pernas"],"posterior",["panturrilha","gluteos","costas"],3,"kettlebell",["Kettlebell entre os pés.","Leve ao ombro com impulso do quadril.","Desça."],376],["Levantamento terra unilateral com kettlebell",["pernas"],"posterior",["gluteos","costas"],3,"kettlebell",["Kettlebell numa mão, em pé numa perna.","Incline o tronco levando a outra perna para trás.","Volte."],377],["Tríceps acima da cabeça com kettlebell",["triceps"],"triceps",["ombros","abdomen"],1,"kettlebell",["Kettlebell acima da cabeça.","Desça atrás da cabeça.","Estenda."],-1],["Passagem entre as pernas com kettlebell",["abdomen"],"abdomen",["gluteos","posterior","ombros"],3,"kettlebell",["Kettlebell entre as pernas.","Passe de uma mão para a outra."],379],["Navio pirata com kettlebell",["ombros"],"ombros",["abdomen"],2,"kettlebell",["Kettlebell nas mãos, pernas afastadas.","Balance de um lado para o outro."],380],["Agachamento pistola com kettlebell",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"kettlebell",["Kettlebell no peito, uma perna à frente.","Agache numa perna só.","Suba."],381],["Desenvolvimento sentado com kettlebell",["ombros"],"ombros",["triceps"],3,"kettlebell",["Sentado no chão, kettlebell no ombro.","Empurre para cima.","Desça."],382],["Desenvolvimento gangorra com kettlebells",["ombros"],"ombros",["triceps"],3,"kettlebell",["Kettlebells nos ombros.","Empurre um enquanto desce o outro."],383],["Remada alta sumô com kettlebell",["trapezio"],"costas",["quadriceps","gluteos","posterior"],3,"kettlebell",["Kettlebell entre os pés, base larga.","Suba até o peito com cotovelos altos.","Desça."],384],["Thruster com kettlebells",["ombros"],"ombros",["quadriceps","triceps"],3,"kettlebell",["Kettlebells nos ombros.","Agache e suba empurrando-os acima da cabeça."],385],["Levantamento turco (estilo afundo)",["ombros"],"ombros",["abdomen","posterior","quadriceps"],3,"kettlebell",["Deitado, kettlebell acima.","Levante até ficar em pé passando por um afundo.","Volte."],386],["Levantamento turco (estilo agachamento)",["ombros"],"ombros",["abdomen","panturrilha","posterior"],3,"kettlebell",["Deitado, kettlebell acima.","Levante até ficar em pé passando por um agachamento.","Volte."],387],["Moinho com kettlebell",["abdomen"],"abdomen",["gluteos","posterior","ombros"],3,"kettlebell",["Kettlebell acima da cabeça.","Desça o tronco até a mão livre tocar o pé.","Suba."],388],["Muscle up com impulso",["costas"],"costas",["abdomen","biceps","ombros"],3,"academia",["Nas argolas.","Balance e puxe até passar por cima delas.","Empurre."],389],["Joelho cruzando o corpo",["mobilidade"],"mobilidade",[],2,"corpo",["Deitado, uma perna dobrada.","Leve o joelho cruzando o corpo.","Segure e troque."],390],["Círculos com os joelhos",["mobilidade"],"mobilidade",[],2,"corpo",["Em pé, pernas juntas.","Faça círculos com os joelhos.","Inverta."],391],["Salto grupado",["pernas"],"posterior",["gluteos","quadriceps","panturrilha"],2,"corpo",["Em pé.","Salte levando os joelhos ao peito.","Aterrisse suave."],393],["Treino de braços ajoelhado",["ombros"],"ombros",["abdomen"],2,"corpo",["Ajoelhado.","Balance os braços como na corrida."],394],["Abdominal ajoelhado na polia com giro",["abdomen"],"abdomen",[],1,"academia",["De joelhos sob a polia alta.","Faça o abdominal girando para um lado.","Alterne."],395],["Tríceps ajoelhado na polia",["triceps"],"triceps",[],3,"academia",["Ajoelhado de costas para a polia.","Estenda os braços à frente.","Volte."],396],["Alongamento de antebraço ajoelhado",["mobilidade"],"mobilidade",[],1,"corpo",["Ajoelhado, palmas no chão com dedos para trás.","Incline para trás devagar.","Segure."],397],["Remada alta ajoelhado na polia",["costas"],"costas",["biceps"],2,"academia",["Ajoelhado, corda na polia alta.","Puxe até o peito.","Volte."],398],["Alongamento de flexor do quadril ajoelhado",["mobilidade"],"mobilidade",[],1,"corpo",["Um joelho no chão, o outro à frente.","Leve o quadril à frente.","Segure e troque."],399],["Agachamento com salto ajoelhado",["gluteos"],"gluteos",["panturrilha","posterior","quadriceps"],5,"barra",["Ajoelhado, barra nas costas.","Salte ficando de pé."],400],["Remada alta unilateral ajoelhado",["costas"],"costas",["biceps"],2,"academia",["Ajoelhado, alça da polia alta.","Puxe até o peito.","Volte e troque."],401],["Agachamento ajoelhado",["gluteos"],"gluteos",["abdomen","posterior","costas"],3,"barra",["Ajoelhado com barra nas costas.","Sente nos calcanhares e suba."],402],["Landmine 180",["abdomen"],"abdomen",["gluteos","costas","ombros"],2,"barra",["Barra presa num canto.","Gire a barra de um lado para o outro."],403],["Landmine linear",["ombros"],"ombros",["abdomen","panturrilha","peito"],3,"barra",["Barra presa num canto.","Empurre a ponta à frente e para cima."],404],["Salto lateral",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"corpo",["Meio agachado.","Salte para o lado e aterrisse na outra perna."],405],["Salto lateral na caixa",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Caixa ao lado.","Salte de lado sobre ela.","Desça."],406],["Saltos laterais sobre cones",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Cones enfileirados.","Salte de lado sobre eles."],407],["Elevação lateral com elástico",["ombros"],"ombros",[],1,"elastico",["Pise no elástico.","Abra os braços até os ombros.","Desça."],408],["Liberação do grande dorsal com rolo",["mobilidade"],"mobilidade",[],1,"academia",["Deitado de lado, rolo sob a axila.","Role ao longo das costas."],409],["Supino no chão com perna por cima",["peito"],"peito",["ombros","triceps"],3,"kettlebell",["Deitado com kettlebell no peito, perna dobrada por cima.","Empurre.","Desça."],410],["Alongamento de posterior com perna para cima",["mobilidade"],"mobilidade",[],1,"corpo",["Deitado, uma perna dobrada.","Estenda a outra para cima.","Segure."],411],["Elevação de perna lateral",["gluteos"],"gluteos",["posterior"],1,"corpo",["Em pé segurando um apoio.","Suba uma perna para o lado.","Desça e troque."],413],["Puxada de pernas no solo",["abdomen"],"abdomen",[],2,"corpo",["Deitado, pernas estendidas.","Leve os joelhos ao peito.","Estenda."],415],["Supino na máquina articulada",["peito"],"peito",["ombros","triceps"],2,"academia",["Sentado na máquina.","Empurre as alças à frente.","Volte."],416],["Levantamento terra na máquina articulada",["pernas"],"quadriceps",["gluteos","posterior"],2,"academia",["Entre as alças.","Suba estendendo quadril e joelhos.","Desça."],417],["Supino declinado na máquina articulada",["peito"],"peito",["ombros","triceps"],2,"academia",["Sentado na máquina.","Empurre para baixo e à frente.","Volte."],418],["Remada alta na máquina articulada",["costas"],"costas",[],2,"academia",["Sentado, alças acima.","Puxe para baixo e para trás.","Volte."],419],["Supino inclinado na máquina articulada",["peito"],"peito",["ombros","triceps"],2,"academia",["Sentado na máquina.","Empurre para cima e à frente.","Volte."],420],["Remada isolateral na máquina",["costas"],"costas",["biceps"],2,"academia",["Sentado, alças na altura do peito.","Puxe até o tronco.","Volte."],421],["Desenvolvimento na máquina articulada",["ombros"],"ombros",["triceps"],2,"academia",["Sentado, alças nos ombros.","Empurre para cima.","Desça."],422],["Encolhimento na máquina articulada",["trapezio"],"costas",["biceps"],1,"academia",["Entre as alças.","Suba os ombros.","Desça."],423],["Saída em três tempos",["pernas"],"posterior",["panturrilha","quadriceps"],2,"corpo",["Posição de largada.","Acelere ao máximo nos primeiros passos."],424],["Treino de aceleração na parede",["pernas"],"posterior",["panturrilha","gluteos","quadriceps"],2,"corpo",["Inclinado contra a parede.","Alterne os joelhos rapidamente."],425],["Salto em profundidade linear",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Em pé numa caixa.","Desça e salte imediatamente à frente."],426],["Levantamento de tora",["ombros"],"ombros",["abdomen","peito","gluteos"],3,"academia",["Tora à frente.","Leve aos ombros e empurre acima da cabeça.","Desça."],427],["Pontes de Londres",["costas"],"costas",["biceps"],3,"academia",["Corda suspensa.","Suba e desça a corda puxando com os braços."],428],["Olhando para o teto",["mobilidade"],"mobilidade",[],1,"corpo",["Ajoelhado, mãos nos calcanhares.","Leve o quadril à frente e olhe para cima.","Segure."],429],["Crossover na polia baixa",["peito"],"peito",["ombros"],1,"academia",["Polias baixas.","Junte as mãos à frente do peito subindo.","Volte."],430],["Tríceps na polia baixa deitado",["triceps"],"triceps",[],1,"academia",["Deitado, corda da polia baixa atrás da cabeça.","Estenda os cotovelos.","Volte."],431],["Remada baixa até o pescoço",["ombros"],"ombros",["biceps","costas"],2,"academia",["Remada baixa com corda.","Puxe até o pescoço com cotovelos altos.","Volte."],432],["Liberação da lombar com rolo",["mobilidade"],"mobilidade",[],2,"academia",["Sentado, rolo sob a lombar.","Role devagar."],433],["Extensão lombar no solo",["mobilidade"],"mobilidade",[],2,"corpo",["De bruços, braços abertos.","Suba o peito usando a lombar.","Desça."],434],["Afundo com passagem de kettlebell",["pernas"],"posterior",["panturrilha","gluteos","quadriceps"],3,"kettlebell",["Kettlebell numa mão.","Dê um passo e passe o kettlebell por baixo da perna.","Alterne."],435],["Sprint de afundo no Smith",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Barra do Smith nas costas.","Troque as pernas rapidamente em afundo."],436],["Alongamento de virilha deitado",["mobilidade"],"mobilidade",[],5,"academia",["Deitado, solas dos pés juntas.","Deixe os joelhos caírem para os lados.","Segure."],437],["Rosca deitado na polia",["biceps"],"biceps",[],3,"academia",["Deitado, barra da polia baixa.","Suba a barra.","Desça."],438],["Remada deitado com barra curvada",["costas"],"costas",["biceps"],1,"barra",["De bruços no banco, barra embaixo.","Puxe até o banco.","Desça."],439],["Rosca deitado na polia alta",["biceps"],"biceps",[],1,"academia",["Deitado, barra da polia alta acima.","Puxe até a testa.","Volte."],440],["Tríceps deitado atrás da cabeça",["triceps"],"triceps",[],3,"barra",["Deitado, barra com pegada fechada.","Desça atrás da cabeça.","Estenda."],441],["Tríceps deitado até o queixo",["triceps"],"triceps",[],3,"barra",["Deitado, barra fechada.","Desça até o queixo.","Estenda."],442],["Cruzamento deitado",["mobilidade"],"mobilidade",[],5,"corpo",["Deitado, cruze uma perna sobre o corpo.","Segure e troque."],443],["Tríceps testa com halteres",["triceps"],"triceps",["peito","ombros"],3,"halteres",["Deitado, halteres acima do peito.","Desça dobrando os cotovelos.","Estenda."],444],["Resistência de pescoço de bruços com anilha",["trapezio"],"costas",[],3,"academia",["De bruços, anilha na nuca.","Suba e desça a cabeça."],445],["Resistência de pescoço de costas com anilha",["trapezio"],"costas",[],3,"academia",["De costas, anilha na testa.","Suba e desça a cabeça."],446],["Alongamento de glúteo deitado",["mobilidade"],"mobilidade",[],5,"corpo",["Deitado, um joelho ao peito.","Gire a perna para dentro.","Segure."],447],["Alongamento de posterior deitado",["mobilidade"],"mobilidade",[],5,"academia",["Deitado, uma perna para cima.","Puxe em sua direção.","Segure."],448],["Rosca deitado no banco alto",["biceps"],"biceps",[],3,"barra",["De bruços num banco alto, barra pendurada.","Suba a barra.","Desça."],449],["Agachamento deitado na máquina",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Deitado na máquina.","Empurre estendendo as pernas.","Volte."],451],["Elevação lateral unilateral deitado",["ombros"],"ombros",[],3,"halteres",["De bruços, halter numa mão.","Abra o braço para o lado.","Desça."],452],["Alongamento de quadríceps deitado",["mobilidade"],"mobilidade",[],5,"corpo",["De bruços, calcanhar ao glúteo.","Segure."],453],["Crucifixo invertido deitado",["ombros"],"ombros",[],3,"halteres",["De bruços no banco.","Abra os braços para os lados.","Desça."],454],["Rosca deitado com halteres",["biceps"],"biceps",[],1,"halteres",["Deitado, braços pendurados ao lado do banco.","Suba os halteres.","Desça."],455],["Remada T deitado",["costas"],"costas",["biceps"],3,"academia",["Peito no apoio da máquina.","Puxe as alças.","Desça."],456],["Tríceps testa com pullover",["triceps"],"triceps",[],3,"barra",["Deitado, barra no chão atrás.","Pegue, estenda e desça até a testa.","Estenda."],457],["Rosca na máquina",["biceps"],"biceps",[],1,"academia",["Braços apoiados.","Suba as alças.","Desça."],459],["Rosca scott na máquina",["biceps"],"biceps",[],1,"academia",["Braços no apoio.","Suba as alças.","Desça."],460],["Desenvolvimento na máquina",["ombros"],"ombros",["triceps"],2,"academia",["Sentado, alças nos ombros.","Empurre para cima.","Desça."],461],["Tríceps na máquina",["triceps"],"triceps",[],1,"academia",["Braços apoiados.","Estenda os cotovelos.","Volte."],462],["Passe de peito com medicine ball",["peito"],"peito",["ombros","triceps"],2,"academia",["De frente para parceiro ou parede.","Lance a bola do peito.","Receba."],463],["Giro completo com medicine ball",["abdomen"],"abdomen",["ombros"],2,"academia",["De costas para o parceiro.","Gire e passe a bola."],464],["Arremesso por baixo com medicine ball",["ombros"],"ombros",["abdomen","posterior","quadriceps"],2,"academia",["Semiagachado, bola entre as pernas.","Lance a bola para cima e para trás."],465],["Encolhimento de escápulas no inclinado",["costas"],"costas",[],3,"halteres",["De bruços no inclinado, halteres pendurados.","Junte as escápulas.","Solte."],466],["Alongamento de meio das costas",["mobilidade"],"mobilidade",[],1,"corpo",["Mãos no quadril.","Gire o tronco para um lado.","Troque."],467],["Barra fixa pegada mista",["costas"],"costas",["biceps"],5,"academia",["Uma mão pronada, outra supinada.","Puxe até o queixo passar.","Desça."],468],["Caminhada monstro",["gluteos"],"gluteos",[],2,"elastico",["Elásticos nos tornozelos e joelhos.","Ande em diagonal com passos curtos."],469],["Escalador (mountain climber)",["pernas"],"quadriceps",["peito","posterior","ombros"],2,"corpo",["Em posição de flexão.","Leve os joelhos ao peito alternando rápido.","Mantenha o quadril baixo."],470],["Série de garra em movimento",["pernas"],"posterior",["panturrilha","quadriceps"],2,"corpo",["Correndo.","Puxe o pé para baixo e para trás como uma garra a cada passo."],471],["Muscle snatch",["pernas"],"posterior",["gluteos","costas","quadriceps"],3,"barra",["Barra nas coxas com pegada aberta.","Puxe até acima da cabeça sem agachar.","Desça."],472],["Muscle up nas argolas",["costas"],"costas",["abdomen","biceps","ombros"],3,"academia",["Nas argolas.","Puxe até o peito e passe por cima.","Empurre até estender."],473],["Hack com base fechada",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Costas no apoio, pés juntos na plataforma.","Desça até 90°.","Suba."],474],["Leg press com base fechada",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Pés juntos na plataforma.","Desça até 90°.","Empurre."],475],["Agachamento com base fechada",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra nas costas, pés próximos.","Desça até as coxas paralelas.","Suba."],476],["Liberação do pescoço com rolo",["mobilidade"],"mobilidade",[],3,"academia",["Rolo atrás do pescoço.","Role devagar de cima a baixo."],478],["Supino até o pescoço",["peito"],"peito",["ombros","triceps"],3,"barra",["Deitado, barra com pegada média.","Desça a barra até o pescoço.","Empurre. Use carga leve."],479],["Abdominal oblíquo",["abdomen"],"abdomen",[],1,"corpo",["Deitado, lombar no chão, mãos atrás da cabeça.","Leve um cotovelo ao joelho oposto.","Alterne."],480],["Agachamento olímpico",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra alta nas costas, peito para cima.","Desça bem fundo.","Suba."],482],["Alongamento de quadríceps de costas",["mobilidade"],"mobilidade",[],1,"academia",["Deitado na borda, perna pendurada.","Puxe o calcanhar ao glúteo.","Segure."],483],["Alongamento de quadríceps de lado",["mobilidade"],"mobilidade",[],1,"corpo",["Deitado de lado.","Puxe o calcanhar de cima ao glúteo.","Segure."],484],["Crucifixo unilateral com halter",["peito"],"peito",[],1,"halteres",["Deitado, halter numa mão.","Abra o braço para o lado.","Volte e troque."],486],["Flexão lateral unilateral na polia alta",["abdomen"],"abdomen",[],1,"academia",["De lado para a polia alta.","Incline o tronco para o lado oposto.","Volte."],487],["Clean unilateral com kettlebell",["pernas"],"posterior",["gluteos","costas","ombros"],3,"kettlebell",["Kettlebell entre os pés.","Leve ao ombro com uma mão.","Desça."],489],["Arremesso unilateral com kettlebell",["ombros"],"ombros",[],3,"kettlebell",["Kettlebell no ombro.","Empurre com impulso das pernas acima da cabeça.","Desça."],490],["Supino no chão unilateral com kettlebell",["peito"],"peito",["triceps"],3,"kettlebell",["Deitado, kettlebell numa mão.","Empurre.","Desça."],491],["Jerk unilateral com kettlebell",["ombros"],"ombros",["panturrilha","quadriceps","triceps"],3,"kettlebell",["Kettlebell no ombro.","Use as pernas para travar o braço acima da cabeça."],492],["Desenvolvimento lateral unilateral com kettlebell",["ombros"],"ombros",["triceps"],3,"kettlebell",["Kettlebell no ombro.","Incline o tronco e empurre para cima."],493],["Para press com kettlebell",["ombros"],"ombros",["triceps"],3,"kettlebell",["Kettlebell no ombro, cotovelo aberto.","Empurre para cima.","Desça."],494],["Push press unilateral com kettlebell",["ombros"],"ombros",["panturrilha","quadriceps","triceps"],3,"kettlebell",["Kettlebell no ombro.","Agache um pouco e empurre.","Desça."],495],["Remada unilateral com kettlebell",["costas"],"costas",["biceps"],3,"kettlebell",["Tronco inclinado.","Puxe o kettlebell até o quadril.","Desça."],496],["Snatch unilateral com kettlebell",["ombros"],"ombros",["panturrilha","gluteos","posterior"],5,"kettlebell",["Kettlebell entre os pés.","Leve acima da cabeça num só movimento.","Desça."],497],["Split jerk unilateral com kettlebell",["ombros"],"ombros",["gluteos","posterior","quadriceps"],3,"kettlebell",["Kettlebell no ombro.","Empurre afundando as pernas em tesoura."],498],["Split snatch unilateral com kettlebell",["ombros"],"ombros",["posterior","quadriceps"],5,"kettlebell",["Kettlebell numa mão.","Leve acima da cabeça afundando em tesoura."],499],["Swing unilateral com kettlebell",["pernas"],"posterior",["panturrilha","gluteos","costas"],3,"kettlebell",["Kettlebell numa mão entre as pernas.","Balance até a altura do peito com o quadril.","Repita."],500],["Remada unilateral com barra no canto",["costas"],"costas",["biceps"],2,"barra",["Barra presa no canto.","Puxe a ponta com uma mão.","Desça."],501],["Arremesso unilateral de medicine ball no chão",["abdomen"],"abdomen",["costas","ombros"],2,"academia",["Bola numa mão acima da cabeça.","Arremesse no chão com força."],502],["Clean de palma aberta com kettlebell",["pernas"],"posterior",["biceps","gluteos","costas"],3,"kettlebell",["Kettlebell entre os pés.","Leve ao alto abrindo a mão e pegue de novo."],503],["Agachamento unilateral com kettlebell acima",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"kettlebell",["Kettlebell travado acima da cabeça.","Agache.","Suba."],504],["Levantamento terra lateral unilateral",["pernas"],"quadriceps",["abdomen","panturrilha","gluteos"],5,"barra",["De lado para a barra.","Pegue no centro com uma mão e suba.","Desça."],505],["Elevação lateral unilateral",["ombros"],"ombros",[],1,"halteres",["Halter numa mão, outra mão num apoio.","Suba o braço para o lado.","Desça."],506],["Alongamento de peito na parede",["mobilidade"],"mobilidade",[],1,"corpo",["Braço dobrado apoiado na parede.","Gire o corpo para o lado oposto.","Segure."],508],["Barra fixa com um braço",["costas"],"costas",["biceps"],5,"academia",["Uma mão na barra, a outra na toalha.","Puxe até o queixo passar.","Desça."],509],["Supino unilateral com halter",["peito"],"peito",["ombros","triceps"],2,"halteres",["Deitado, halter numa mão.","Empurre.","Desça e troque."],510],["Rosca scott unilateral com halter",["biceps"],"biceps",[],1,"halteres",["Braço no banco scott.","Suba o halter.","Desça."],511],["Supino unilateral no chão",["triceps"],"triceps",["peito","ombros"],3,"barra",["Deitado no chão, halter numa mão.","Empurre.","Desça."],512],["Puxada unilateral",["costas"],"costas",["biceps"],2,"academia",["Alça da polia alta numa mão.","Puxe até o ombro.","Volte."],513],["Tríceps unilateral deitado pegada pronada",["triceps"],"triceps",[],1,"halteres",["Deitado, halter acima.","Desça em direção ao ombro oposto.","Estenda."],514],["Tríceps unilateral deitado pegada supinada",["triceps"],"triceps",[],1,"halteres",["Deitado, halter acima, palma para você.","Desça ao lado da cabeça.","Estenda."],515],["Meio gafanhoto",["mobilidade"],"mobilidade",[],2,"corpo",["De bruços.","Levante uma perna estendida.","Desça e troque."],516],["Suspensão com uma mão",["mobilidade"],"mobilidade",[],2,"academia",["Uma mão na barra.","Fique pendurado pelo tempo possível."],517],["Joelho ao peito",["mobilidade"],"mobilidade",[],2,"corpo",["Deitado.","Puxe um joelho ao peito.","Segure e troque."],518],["Agachamento unilateral com barra",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Barra nas costas, pé de trás num banco.","Desça na perna da frente.","Suba."],519],["Clean de palma aberta",["pernas"],"posterior",["gluteos","costas","quadriceps"],5,"kettlebell",["Kettlebell entre os pés.","Leve ao alto e pegue com a mão aberta."],520],["Otis up",["abdomen"],"abdomen",["peito","ombros","triceps"],2,"academia",["Deitado com peso no peito, pés presos.","Suba o tronco e empurre o peso acima."],521],["Rosca na polia acima da cabeça",["biceps"],"biceps",[],3,"academia",["Entre duas polias altas.","Puxe as alças em direção às orelhas.","Volte."],522],["Alongamento de grande dorsal acima da cabeça",["mobilidade"],"mobilidade",[],5,"academia",["Braço para cima com cotovelo dobrado.","Parceiro empurra levemente.","Segure."],523],["Arremesso de bola no chão (slam)",["costas"],"costas",[],2,"academia",["Bola acima da cabeça.","Arremesse no chão com força.","Pegue e repita."],524],["Agachamento acima da cabeça",["pernas"],"quadriceps",["abdomen","panturrilha","gluteos"],5,"barra",["Barra travada acima da cabeça com pegada aberta.","Agache.","Suba."],525],["Alongamento acima da cabeça",["mobilidade"],"mobilidade",[],2,"corpo",["Dedos entrelaçados, palmas para cima.","Estique os braços acima.","Segure."],526],["Alongamento de tríceps acima da cabeça",["mobilidade"],"mobilidade",[],5,"corpo",["Braço dobrado atrás da cabeça.","Puxe o cotovelo.","Segure."],527],["Pallof press",["abdomen"],"abdomen",["peito","ombros","triceps"],1,"academia",["De lado para a polia na altura do peito.","Empurre a alça à frente sem girar.","Volte."],528],["Pallof press com rotação",["abdomen"],"abdomen",["peito","ombros","triceps"],2,"academia",["De lado para a polia.","Empurre e gire o tronco para o lado oposto.","Volte."],529],["Rosca de punho invertida com halteres no banco",["antebraco"],"biceps",[],1,"halteres",["Antebraços sobre o banco, palmas para baixo.","Suba os punhos.","Desça."],530],["Rosca de punho invertida com barra no banco",["antebraco"],"biceps",[],1,"barra",["Antebraços sobre o banco, palmas para baixo.","Suba os punhos.","Desça."],531],["Rosca de punho com barra no banco",["antebraco"],"biceps",[],1,"barra",["Antebraços sobre o banco, palmas para cima.","Suba os punhos.","Desça."],532],["Rosca de punho com halteres no banco",["antebraco"],"biceps",[],1,"halteres",["Antebraços sobre o banco, palmas para cima.","Suba os punhos.","Desça."],533],["Retroversão pélvica até ponte",["mobilidade"],"mobilidade",[],3,"corpo",["Deitado, joelhos dobrados.","Encaixe o quadril e suba vértebra por vértebra.","Desça."],535],["Liberação dos fibulares com rolo",["mobilidade"],"mobilidade",[],3,"academia",["De lado, rolo na parte de fora da canela.","Role devagar."],536],["Alongamento dos fibulares",["mobilidade"],"mobilidade",[],3,"academia",["Sentado, faixa no pé.","Puxe o pé para fora.","Segure."],537],["Ponte de quadril na bola",["gluteos"],"gluteos",["posterior"],2,"academia",["Costas na bola, pés no chão.","Suba o quadril.","Desça."],538],["Supino a partir dos pinos",["triceps"],"triceps",["peito","biceps","costas"],3,"barra",["Barra nos pinos.","Empurre a partir da parada.","Volte aos pinos."],539],["Liberação do piriforme com rolo",["mobilidade"],"mobilidade",[],3,"academia",["Sentado sobre o rolo, tornozelo cruzado sobre o joelho.","Role o glúteo."],540],["Pinça de anilhas",["antebraco"],"biceps",[],3,"academia",["Duas anilhas juntas.","Segure pelas bordas com os dedos.","Segure pelo tempo."],542],["Giro com anilha",["abdomen"],"abdomen",[],3,"academia",["Sentado, tronco inclinado, anilha nas mãos.","Gire de um lado para o outro."],543],["Deslize de posterior",["pernas"],"posterior",["gluteos"],1,"academia",["Deitado, calcanhares sobre pano.","Puxe os pés deslizando em direção ao glúteo.","Estenda."],544],["Flexão pliométrica sobre kettlebell",["peito"],"peito",["ombros","triceps"],5,"kettlebell",["Uma mão no kettlebell.","Flexão explosiva trocando de mão."],546],["Flexão pliométrica",["peito"],"peito",["ombros","triceps"],2,"corpo",["Em posição de flexão.","Desça e empurre tirando as mãos do chão."],547],["Alongamento do tibial posterior",["mobilidade"],"mobilidade",[],3,"academia",["Sentado, faixa no pé.","Puxe o pé para dentro.","Segure."],548],["Power clean",["pernas"],"posterior",["panturrilha","biceps","gluteos"],3,"barra",["Barra no chão.","Puxe explosivamente e receba nos ombros sem agachar fundo."],549],["Power clean a partir de blocos",["pernas"],"posterior",["quadriceps"],3,"barra",["Barra sobre blocos.","Puxe e receba nos ombros."],550],["Power jerk",["pernas"],"quadriceps",["abdomen","panturrilha","gluteos"],5,"barra",["Barra nos ombros.","Desça um pouco e empurre acima da cabeça."],551],["Rosca parcial explosiva",["ombros"],"ombros",[],1,"halteres",["Halteres nas mãos.","Faça meias repetições rápidas."],552],["Power snatch",["pernas"],"posterior",["panturrilha","gluteos","costas"],5,"barra",["Barra no chão com pegada aberta.","Leve acima da cabeça num só movimento."],553],["Power snatch a partir de blocos",["pernas"],"quadriceps",["panturrilha","biceps","gluteos"],3,"barra",["Barra sobre blocos.","Leve acima da cabeça num só movimento."],554],["Escada com carga",["pernas"],"posterior",["quadriceps","panturrilha","gluteos"],3,"academia",["Carga pesada.","Suba a carga degrau por degrau."],555],["Rosca scott martelo com halteres",["biceps"],"biceps",[],1,"halteres",["Braços no scott, palmas para dentro.","Suba.","Desça."],557],["Abdominal com desenvolvimento",["abdomen"],"abdomen",["peito","ombros","triceps"],5,"barra",["Deitado, barra no peito.","Suba o tronco empurrando a barra acima.","Desça."],558],["Flexora manual de bruços",["pernas"],"posterior",[],1,"corpo",["De bruços, parceiro segura o tornozelo.","Puxe o calcanhar contra a resistência."],559],["Sprint com trenó (prowler)",["cardio"],"cardio",[],2,"academia",["Mãos no trenó.","Empurre correndo."],560],["Puxada entre as pernas na polia",["gluteos"],"gluteos",["posterior","costas"],2,"academia",["De costas para a polia baixa, corda entre as pernas.","Estenda o quadril.","Volte."],561],["Flexão aberta",["peito"],"peito",["abdomen","ombros","triceps"],2,"corpo",["Mãos bem afastadas.","Desça o peito.","Empurre."],563],["Flexão com pés elevados",["peito"],"peito",["ombros","triceps"],2,"corpo",["Pés num banco.","Desça o peito.","Empurre."],565],["Flexão com pés na bola",["peito"],"peito",["ombros","triceps"],3,"academia",["Pés sobre a bola.","Desça o peito.","Empurre."],566],["Push press",["ombros"],"ombros",["quadriceps","triceps"],5,"barra",["Barra nos ombros.","Agache um pouco e empurre acima da cabeça.","Desça."],567],["Push press por trás da nuca",["ombros"],"ombros",["panturrilha","quadriceps","triceps"],3,"barra",["Barra nas costas.","Agache um pouco e empurre.","Desça."],568],["Flexão com prancha lateral",["peito"],"peito",["abdomen","ombros","triceps"],2,"corpo",["Faça uma flexão.","Gire para a prancha lateral.","Volte e alterne."],569],["Flexão fechada e aberta",["peito"],"peito",["ombros","triceps"],2,"corpo",["Alterne flexões com mãos próximas e afastadas."],571],["Pirâmide na bola",["mobilidade"],"mobilidade",[],2,"academia",["Quadril sobre a bola.","Suba o quadril formando uma pirâmide.","Segure."],572],["Alongamento de quadríceps",["mobilidade"],"mobilidade",[],3,"academia",["De lado, faixa no pé de cima.","Puxe o calcanhar ao glúteo.","Segure."],573],["Liberação do quadríceps com rolo",["mobilidade"],"mobilidade",[],3,"academia",["De bruços, rolo sob as coxas.","Role do quadril ao joelho."],574],["Salto rápido na caixa",["pernas"],"quadriceps",["panturrilha","posterior"],2,"academia",["De frente para a caixa.","Salte em cima rapidamente."],575],["Entrega no rack",["ombros"],"ombros",["biceps","costas"],3,"barra",["Barra nas coxas.","Leve a barra aos ombros rapidamente."],576],["Rack pull com elástico",["costas"],"costas",["biceps","gluteos","posterior"],3,"barra",["Barra nos pinos, elásticos presos.","Suba estendendo o quadril.","Desça."],577],["Rack pull",["costas"],"costas",["biceps","gluteos","posterior"],3,"barra",["Barra nos pinos abaixo dos joelhos.","Suba estendendo o quadril.","Desça."],578],["Elevação de perna para trás",["mobilidade"],"mobilidade",[],2,"corpo",["De quatro.","Suba uma perna estendida para trás.","Desça e troque."],579],["Bicicleta reclinada",["cardio"],"cardio",[],2,"academia",["Ajuste o banco.","Pedale no ritmo desejado."],580],["Empurrada de retorno",["ombros"],"ombros",["peito","triceps"],2,"academia",["Postura atlética.","Receba a bola e devolva com força."],581],["Supino com elástico reverso",["triceps"],"triceps",["peito","biceps","costas"],3,"barra",["Elásticos no alto do rack aliviando a barra.","Desça e empurre."],582],["Agachamento no caixote com elástico reverso",["pernas"],"quadriceps",["gluteos","panturrilha","biceps"],3,"barra",["Elásticos aliviando a barra.","Sente no caixote e suba."],583],["Levantamento terra com elástico reverso",["costas"],"costas",["gluteos","quadriceps","panturrilha"],5,"barra",["Elásticos aliviando a barra.","Suba e desça."],584],["Agachamento com elástico reverso",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Elásticos aliviando a barra.","Agache e suba."],585],["Terra sumô com elástico reverso",["pernas"],"posterior",["gluteos","quadriceps","panturrilha"],5,"barra",["Elásticos aliviando a barra, base larga.","Suba e desça."],586],["Rosca scott inversa",["biceps"],"biceps",[],3,"barra",["Barra W com palmas para baixo no scott.","Suba.","Desça."],588],["Rosca inversa na polia",["biceps"],"biceps",[],1,"academia",["Barra da polia baixa, palmas para baixo.","Suba.","Desça."],589],["Crucifixo invertido no inclinado",["ombros"],"ombros",[],1,"halteres",["De bruços no inclinado.","Abra os braços para os lados.","Desça."],591],["Crucifixo invertido com rotação externa",["ombros"],"ombros",[],3,"halteres",["De bruços no inclinado.","Abra os braços girando os punhos para fora.","Desça."],592],["Remada curvada pegada supinada",["costas"],"costas",["biceps","ombros"],3,"barra",["Barra com palmas para cima, tronco inclinado.","Puxe até o abdômen.","Desça."],593],["Hiperextensão reversa",["pernas"],"posterior",["panturrilha","gluteos"],3,"academia",["Tronco apoiado, pernas penduradas.","Suba as pernas até alinhar.","Desça."],595],["Rosca inversa com anilha",["biceps"],"biceps",[],1,"academia",["Anilha nas mãos, palmas para baixo.","Suba.","Desça."],597],["Supino pegada invertida para tríceps",["triceps"],"triceps",["peito","ombros"],3,"barra",["Deitado, barra com palmas para você.","Desça e empurre."],598],["Liberação dos romboides com rolo",["mobilidade"],"mobilidade",[],3,"academia",["Deitado, rolo sob a parte alta das costas.","Role devagar."],599],["Carregamento de riquixá",["antebraco"],"biceps",["abdomen","panturrilha","gluteos"],3,"academia",["Estrutura carregada, mãos nas alças.","Levante e ande rápido pela distância."],600],["Levantamento terra no riquixá",["pernas"],"quadriceps",["biceps","gluteos","posterior"],3,"academia",["Entre as alças da estrutura.","Suba estendendo quadril e joelhos.","Desça."],601],["Paralelas nas argolas",["triceps"],"triceps",["peito","ombros"],3,"academia",["Braços estendidos nas argolas.","Desça dobrando os cotovelos.","Suba."],602],["Salto foguete",["pernas"],"quadriceps",["panturrilha","posterior"],2,"corpo",["Pés na largura dos ombros.","Agache e salte esticando os braços para cima."],603],["Panturrilha em pé balançando",["panturrilha"],"panturrilha",[],1,"barra",["Barra nas costas.","Suba na ponta dos pés e balance para os calcanhares."],604],["Barra fixa Rocky (frente e nuca)",["costas"],"costas",["biceps","ombros"],3,"academia",["Pegada aberta.","Alterne puxadas pela frente e por trás da nuca."],605],["Terra romeno com déficit",["pernas"],"posterior",["biceps","gluteos","costas"],3,"barra",["Em pé sobre uma plataforma.","Desça a barra abaixo dos pés com coluna neutra.","Suba."],607],["Subida na corda",["costas"],"costas",["biceps","ombros"],3,"academia",["Mãos na corda acima da cabeça.","Puxe e prenda a corda com os pés.","Continue subindo."],608],["Abdominal na polia com corda",["abdomen"],"abdomen",[],1,"academia",["De joelhos de frente para a polia.","Enrole o tronco puxando a corda.","Volte."],609],["Pular corda",["cardio"],"cardio",[],3,"academia",["Uma ponta da corda em cada mão.","Pule com saltos baixos girando pelos punhos."],610],["Pulldown com corda braços retos",["costas"],"costas",[],1,"academia",["Corda na polia alta, braços estendidos.","Puxe até as coxas.","Volte."],611],["Volta ao mundo com bastão",["mobilidade"],"mobilidade",[],2,"academia",["Bastão à frente com pegada aberta.","Leve por cima da cabeça até as costas.","Volte."],612],["Remo ergométrico",["cardio"],"cardio",[],3,"academia",["Pés presos, puxador nas mãos.","Empurre com as pernas e puxe até o abdômen.","Volte."],613],["Alongamento do corredor",["mobilidade"],"mobilidade",[],2,"corpo",["Uma perna à frente dobrada, a outra atrás estendida.","Mãos no chão.","Segure."],614],["Corrida na esteira",["cardio"],"cardio",[],2,"academia",["Suba na esteira e escolha a velocidade.","Corra num ritmo constante."],615],["Rotação russa",["abdomen"],"abdomen",["costas"],3,"corpo",["Sentado, tronco inclinado para trás.","Gire o tronco de um lado para o outro."],616],["Carregamento de saco de areia",["pernas"],"quadriceps",["abdomen","biceps","panturrilha"],2,"academia",["Saco a alguns metros.","Leve até a plataforma e volte."],617],["Retração escapular na barra",["trapezio"],"costas",[],1,"corpo",["Pendurado na barra.","Suba alguns centímetros só juntando as escápulas.","Desça."],618],["Salto tesoura",["pernas"],"quadriceps",["gluteos","posterior"],2,"corpo",["Em posição de afundo.","Salte trocando as pernas no ar."],620],["Flexora sentado com elástico",["pernas"],"posterior",[],1,"academia",["Sentado, elástico no tornozelo.","Puxe o calcanhar para baixo e para trás.","Volte."],621],["Desenvolvimento com barra sentado (militar)",["ombros"],"ombros",["triceps"],3,"barra",["Sentado, barra nos ombros.","Empurre acima da cabeça.","Desça."],622],["Rotação sentado com barra",["abdomen"],"abdomen",[],1,"barra",["Sentado, barra nas costas.","Gire o tronco de um lado para o outro."],623],["Tríceps unilateral sentado curvado",["triceps"],"triceps",[],1,"halteres",["Sentado, tronco inclinado, halter atrás.","Estenda o braço.","Volte."],624],["Tríceps sentado curvado com halteres",["triceps"],"triceps",[],3,"halteres",["Sentado, tronco inclinado.","Estenda os braços para trás.","Volte."],626],["Alongamento de bíceps sentado",["mobilidade"],"mobilidade",[],5,"corpo",["Sentado, braços para trás.","Parceiro puxa levemente.","Segure."],627],["Desenvolvimento na polia sentado",["ombros"],"ombros",["triceps"],2,"academia",["Sentado, alças nos ombros.","Empurre para cima.","Desça."],629],["Alongamento de panturrilha sentado",["mobilidade"],"mobilidade",[],2,"corpo",["Sentado, perna estendida.","Puxe a ponta do pé.","Segure."],631],["Rosca concentrada com barra",["biceps"],"biceps",[],3,"barra",["Sentado, barra com pegada fechada entre as pernas.","Suba.","Desça."],632],["Rosca sentado com halteres",["biceps"],"biceps",[],1,"halteres",["Sentado, halteres pendurados.","Suba girando as palmas.","Desça."],633],["Rosca aberta sentado",["biceps"],"biceps",[],1,"halteres",["Sentado, halteres apontando para fora.","Suba.","Desça."],634],["Rosca de punho invertida sentado",["antebraco"],"biceps",[],1,"halteres",["Antebraços nas coxas, palmas para baixo.","Suba os punhos.","Desça."],635],["Rosca de punho sentado",["antebraco"],"biceps",[],1,"halteres",["Antebraços nas coxas, palmas para cima.","Suba os punhos.","Desça."],636],["Desenvolvimento sentado com halteres",["ombros"],"ombros",["triceps"],2,"halteres",["Sentado com encosto, halteres nos ombros.","Empurre.","Desça."],637],["Puxada de pernas sentado no banco",["abdomen"],"abdomen",[],2,"corpo",["Sentado, pernas estendidas.","Leve os joelhos ao peito.","Estenda."],638],["Alongamento de posterior sentado",["mobilidade"],"mobilidade",[],2,"corpo",["Sentado, uma perna estendida.","Incline o tronco à frente.","Segure."],639],["Alongamento de deltoide anterior sentado",["mobilidade"],"mobilidade",[],5,"corpo",["Sentado, braços para trás.","Parceiro puxa levemente.","Segure."],640],["Alongamento de glúteo sentado",["mobilidade"],"mobilidade",[],5,"corpo",["Sentado, tornozelo cruzado no joelho.","Incline o tronco à frente.","Segure."],641],["Bom dia sentado",["costas"],"costas",["gluteos"],3,"barra",["Sentado num caixote, barra nas costas.","Incline o tronco à frente.","Volte."],642],["Alongamento de posterior sentado com parceiro",["mobilidade"],"mobilidade",[],5,"corpo",["Sentado, pernas estendidas.","Parceiro empurra as costas levemente.","Segure."],643],["Alongamento de posterior e panturrilha",["mobilidade"],"mobilidade",[],3,"academia",["Sentado, faixa no pé.","Puxe o pé em sua direção.","Segure."],644],["Resistência de pescoço com cinta",["trapezio"],"costas",[],3,"academia",["Cinta de cabeça com peso.","Suba e desça a cabeça."],645],["Cadeira flexora",["pernas"],"posterior",[],1,"academia",["Sentado na máquina.","Puxe os calcanhares para baixo.","Volte devagar."],646],["Recolhimento de pernas sentado",["abdomen"],"abdomen",[],1,"corpo",["Sentado, pernas estendidas.","Leve os joelhos ao peito.","Estenda."],647],["Rosca de punho invertida unilateral",["antebraco"],"biceps",[],3,"halteres",["Antebraço na coxa, palma para baixo.","Suba o punho.","Desça."],648],["Rosca de punho unilateral",["antebraco"],"biceps",[],1,"halteres",["Antebraço na coxa, palma para cima.","Suba o punho.","Desça."],649],["Remada baixa unilateral",["costas"],"costas",["biceps"],3,"academia",["Alça da polia baixa numa mão.","Puxe até o tronco.","Volte e troque."],650],["Alongamento sentado acima da cabeça",["mobilidade"],"mobilidade",[],1,"corpo",["Sentado, solas juntas.","Braços para cima e incline para os lados."],651],["Elevação lateral sentado",["ombros"],"ombros",[],1,"halteres",["Sentado, halteres ao lado.","Suba até a altura dos ombros.","Desça."],654],["Tríceps francês sentado",["triceps"],"triceps",[],1,"halteres",["Sentado, halter acima da cabeça com as duas mãos.","Desça atrás da cabeça.","Estenda."],655],["Rosca de punho na polia baixa",["antebraco"],"biceps",[],1,"academia",["Antebraços no banco, barra da polia.","Suba os punhos.","Desça."],656],["Desenvolvimento gangorra",["ombros"],"ombros",["abdomen","triceps"],3,"halteres",["Halteres nos ombros.","Empurre um enquanto o outro desce."],657],["Remada espingarda na polia",["costas"],"costas",["biceps"],2,"academia",["Alça da polia baixa numa mão.","Puxe girando o tronco.","Volte."],658],["Círculos com os ombros",["mobilidade"],"mobilidade",[],2,"corpo",["Braços soltos.","Faça círculos com os ombros.","Inverta."],659],["Desenvolvimento com elástico",["ombros"],"ombros",["triceps"],2,"elastico",["Pise no elástico, alças nos ombros.","Empurre para cima.","Desça."],660],["Elevação dos ombros",["mobilidade"],"mobilidade",[],2,"corpo",["Braços soltos.","Suba os ombros até as orelhas e desça."],661],["Alongamento de ombro",["mobilidade"],"mobilidade",[],2,"corpo",["Leve um braço cruzando o corpo.","Segure com a outra mão."],662],["Alongamento deitado de lado",["mobilidade"],"mobilidade",[],2,"corpo",["Deitado de lado.","Estique o braço de cima acima da cabeça.","Segure."],663],["Prancha lateral",["abdomen"],"abdomen",["ombros"],2,"corpo",["De lado, apoiado no antebraço.","Suba o quadril alinhando o corpo.","Segure."],664],["Salto lateral com sprint",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Ao lado de um cone.","Salte de lado sobre ele e saia correndo."],665],["Canivete lateral",["abdomen"],"abdomen",[],2,"corpo",["Deitado de lado.","Suba as pernas e o tronco juntos.","Desça."],666],["Elevação lateral e frontal",["ombros"],"ombros",["costas"],1,"halteres",["Halteres ao lado.","Faça uma elevação lateral e depois uma frontal."],668],["Elevação lateral de perna",["mobilidade"],"mobilidade",[],2,"corpo",["Em pé segurando um apoio.","Suba a perna para o lado.","Desça e troque."],669],["Alongamento de virilha deitado de lado",["mobilidade"],"mobilidade",[],1,"corpo",["Deitado de lado, perna de cima para cima.","Segure."],670],["Alongamento lateral do pescoço",["mobilidade"],"mobilidade",[],1,"corpo",["Incline a cabeça em direção ao ombro.","Segure."],671],["Salto em distância lateral",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"corpo",["Postura atlética.","Salte o mais longe possível para o lado."],672],["Barra fixa de lado a lado",["costas"],"costas",["biceps","ombros"],3,"academia",["Pegada aberta.","Puxe levando a cabeça para um lado e depois para o outro."],673],["Alongamento lateral de punho",["mobilidade"],"mobilidade",[],1,"corpo",["Braço cruzando o corpo.","Puxe o punho.","Segure."],674],["Troca lateral na caixa",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Um pé sobre a caixa.","Troque os pés passando sobre ela de lado."],675],["Crossover unilateral na polia",["peito"],"peito",[],1,"academia",["Alça da polia alta numa mão.","Puxe cruzando à frente do corpo.","Volte."],676],["Landmine unilateral",["ombros"],"ombros",["peito","triceps"],3,"barra",["Barra presa no canto.","Empurre a ponta à frente com uma mão."],677],["Flexão com um braço",["peito"],"peito",["ombros","triceps"],3,"corpo",["Pernas afastadas, um braço apoiado.","Desça e empurre."],678],["Sprint com um cone",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"academia",["Ao lado de um cone.","Mova os pés rapidamente em volta dele."],679],["Agachamento unilateral no caixote alto",["pernas"],"quadriceps",["gluteos","posterior"],2,"academia",["Uma perna sobre o caixote.","Desça até sentar e suba."],680],["Progressão de saltos numa perna",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Cones enfileirados.","Salte numa perna sobre eles."],681],["Salto lateral numa perna",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Numa perna ao lado de um cone.","Salte de lado sobre ele."],682],["Cadeira extensora unilateral",["pernas"],"quadriceps",[],1,"academia",["Sentado na máquina.","Estenda uma perna.","Desça e troque."],683],["Salto com passada numa perna",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Um pé na caixa.","Impulsione e troque."],684],["Elevação frontal com um halter",["ombros"],"ombros",["biceps","costas"],1,"halteres",["Halter segurado com as duas mãos.","Suba à frente até a altura dos olhos.","Desça."],685],["Chute no glúteo numa perna",["pernas"],"quadriceps",["panturrilha","posterior"],2,"corpo",["Numa perna.","Salte levando o calcanhar ao glúteo."],686],["Ponte de glúteo unilateral",["gluteos"],"gluteos",["posterior"],1,"corpo",["Deitado, uma perna estendida no ar.","Suba o quadril.","Desça e troque."],687],["Impulso numa perna na caixa",["pernas"],"quadriceps",["panturrilha","posterior"],2,"academia",["Um pé na caixa.","Empurre e suba."],688],["Abdominal completo (sit-up)",["abdomen"],"abdomen",[],1,"corpo",["Pés presos, joelhos dobrados.","Suba o tronco até os joelhos.","Desça."],689],["Agachamento sentado",["mobilidade"],"mobilidade",[],2,"corpo",["Pés na largura dos ombros.","Desça como se fosse sentar.","Suba."],690],["Patinação",["cardio"],"cardio",[],3,"academia",["Patine num ritmo constante."],691],["Arrasto de trenó com colete",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"academia",["Trenó preso ao colete.","Ande ou corra à frente."],692],["Caminhada para trás com trenó acima",["ombros"],"ombros",["panturrilha","costas","quadriceps"],2,"academia",["Alças acima da cabeça, trenó à frente.","Ande para trás."],693],["Tríceps com trenó acima da cabeça",["triceps"],"triceps",[],1,"academia",["Alças acima da cabeça.","Estenda os cotovelos e dê passos para trás."],694],["Empurrar trenó",["pernas"],"quadriceps",["panturrilha","peito","gluteos"],2,"academia",["Mãos no trenó, corpo inclinado.","Empurre andando ou correndo."],695],["Crucifixo invertido com trenó",["ombros"],"ombros",[],1,"academia",["Alças nas mãos.","Abra os braços puxando o trenó."],696],["Remada com trenó",["costas"],"costas",["biceps"],2,"academia",["Alças nas mãos.","Puxe o trenó até você."],697],["Golpes de marreta no pneu",["abdomen"],"abdomen",["panturrilha","biceps","costas"],2,"academia",["De frente para o pneu.","Golpeie o pneu com a marreta alternando os lados."],698],["Elevação de ombros no Smith inclinado",["ombros"],"ombros",["peito"],1,"barra",["Banco inclinado sob o Smith.","Suba a barra afastando os ombros.","Desça."],699],["Encolhimento no Smith por trás",["trapezio"],"costas",["ombros"],1,"academia",["Barra do Smith atrás do corpo.","Suba os ombros.","Desça."],700],["Supino no Smith",["peito"],"peito",["ombros","triceps"],2,"academia",["Banco reto sob o Smith.","Desça até o peito.","Empurre."],701],["Remada curvada no Smith",["costas"],"costas",["biceps","ombros"],2,"academia",["Barra do Smith na altura dos joelhos.","Puxe até o abdômen.","Desça."],702],["Panturrilha no Smith",["panturrilha"],"panturrilha",[],1,"academia",["Ponta dos pés num bloco, barra nas costas.","Suba na ponta dos pés.","Desça."],703],["Supino fechado no Smith",["triceps"],"triceps",["peito","ombros"],2,"academia",["Banco sob o Smith, pegada fechada.","Desça e empurre."],704],["Supino declinado na máquina Smith",["peito"],"peito",["ombros","triceps"],2,"academia",["Banco declinado sob o Smith.","Desça e empurre."],705],["Hang power clean no Smith",["pernas"],"posterior",["gluteos","costas","quadriceps"],3,"academia",["Barra na altura do joelho.","Puxe explosivamente até os ombros."],706],["Elevação de quadril no Smith",["abdomen"],"abdomen",[],1,"academia",["Deitado com a barra sobre o quadril.","Suba o quadril.","Desça."],707],["Supino inclinado no Smith",["peito"],"peito",["ombros","triceps"],2,"academia",["Banco inclinado sob o Smith.","Desça e empurre."],708],["Leg press no Smith",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Deitado sob a barra, pés nela.","Empurre estendendo as pernas.","Desça."],709],["Remada alta unilateral no Smith",["ombros"],"ombros",["biceps","costas"],2,"academia",["Barra nas coxas.","Puxe com uma mão até o peito.","Desça."],710],["Desenvolvimento no Smith",["ombros"],"ombros",["triceps"],2,"academia",["Sentado sob a barra.","Empurre acima da cabeça.","Desça."],711],["Agachamento pistola no Smith",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Barra nas costas, numa perna.","Agache.","Suba."],712],["Panturrilha reversa no Smith",["panturrilha"],"panturrilha",[],1,"academia",["Calcanhares num bloco.","Suba a ponta dos pés.","Desça."],713],["Agachamento no Smith",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"academia",["Barra do Smith nas costas.","Desça até as coxas paralelas.","Suba."],714],["Stiff no Smith",["pernas"],"posterior",["gluteos","costas"],2,"academia",["Barra do Smith nas mãos.","Incline o tronco com pernas quase retas.","Suba."],715],["Remada alta no Smith",["trapezio"],"costas",["biceps","ombros"],2,"academia",["Barra nas coxas.","Puxe até o peito com cotovelos altos.","Desça."],716],["Agachamento búlgaro no Smith",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"academia",["Pé de trás no banco, barra nas costas.","Desça na perna da frente.","Suba."],717],["Snatch (arranco)",["pernas"],"quadriceps",["biceps","gluteos","posterior"],3,"barra",["Barra no chão, pegada aberta.","Leve acima da cabeça num só movimento agachando.","Fique em pé."],718],["Equilíbrio de arranco",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra nas costas.","Caia num agachamento empurrando a barra acima."],719],["Levantamento terra de arranco",["pernas"],"posterior",["biceps","gluteos","costas"],3,"barra",["Pegada aberta.","Suba a barra com costas retas.","Desça."],720],["Puxada de arranco",["pernas"],"posterior",["panturrilha","gluteos","costas"],3,"barra",["Pegada aberta.","Puxe explosivamente subindo os ombros.","Desça."],721],["Encolhimento de arranco",["trapezio"],"costas",["biceps","ombros"],3,"barra",["Pegada aberta, barra nas coxas.","Estenda o quadril e suba os ombros."],722],["Arranco a partir de blocos",["pernas"],"quadriceps",["panturrilha","biceps","gluteos"],5,"barra",["Barra nos blocos.","Leve acima da cabeça num só movimento."],723],["Tríceps rápido com elástico",["triceps"],"triceps",[],1,"elastico",["Elástico preso embaixo.","Estenda os braços acima da cabeça rapidamente."],724],["Agachamento rápido no caixote",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Elásticos na barra.","Sente e suba rápido."],725],["Agachamento rápido",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Carga leve nas costas.","Agache e suba o mais rápido possível."],726],["Feiticeiro",["abdomen"],"abdomen",["gluteos","ombros"],2,"halteres",["Halteres nas mãos.","Gire o tronco levando os halteres de um lado ao outro."],727],["Engatinhar aranha",["abdomen"],"abdomen",["peito","ombros","triceps"],2,"corpo",["Em posição de flexão.","Ande levando o joelho ao cotovelo do mesmo lado."],728],["Alongamento da coluna",["mobilidade"],"mobilidade",[],1,"corpo",["Sentado, dedos entrelaçados.","Gire o tronco.","Segure."],730],["Split clean",["pernas"],"quadriceps",["panturrilha","biceps","gluteos"],3,"barra",["Barra no chão.","Puxe e receba nos ombros afundando em tesoura."],731],["Split jerk",["pernas"],"quadriceps",["gluteos","posterior","ombros"],3,"barra",["Barra nos ombros.","Empurre acima da cabeça afundando em tesoura."],732],["Salto em afundo",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"corpo",["Em afundo.","Salte trocando as pernas."],733],["Split snatch",["pernas"],"posterior",["panturrilha","biceps","gluteos"],5,"barra",["Barra no chão.","Leve acima da cabeça afundando em tesoura."],734],["Afundo com salto alternado",["mobilidade"],"mobilidade",[],3,"corpo",["Em afundo.","Salte e troque as pernas."],736],["Squat jerk",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Barra nos ombros.","Empurre e receba num agachamento."],737],["Agachamento com elástico",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Elásticos presos à barra.","Agache e suba."],738],["Agachamento com correntes",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Correntes presas à barra.","Agache e suba."],739],["Agachamento com transferência de anilhas",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],3,"barra",["Barra nas costas, anilha ao lado.","Agache, pegue a anilha e leve para o outro lado."],740],["Agachamento com elástico sob os pés",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"elastico",["Pise no elástico, alças nos ombros.","Agache e suba."],741],["Simulador de escada (stairmaster)",["cardio"],"cardio",[],3,"academia",["Suba no aparelho e escolha o programa.","Suba os degraus num ritmo constante."],742],["Desenvolvimento alternado em pé",["ombros"],"ombros",["triceps"],2,"halteres",["Halteres nos ombros.","Empurre um de cada vez.","Desça e alterne."],743],["Desenvolvimento por trás da nuca em pé",["ombros"],"ombros",["triceps"],3,"barra",["Barra atrás da cabeça.","Empurre para cima.","Desça até a nuca."],745],["Tríceps coice unilateral em pé",["triceps"],"triceps",["ombros"],1,"halteres",["Tronco inclinado, halter numa mão.","Estenda o braço para trás.","Volte."],746],["Tríceps coice com dois halteres",["triceps"],"triceps",[],1,"halteres",["Tronco inclinado, halteres nas mãos.","Estenda os braços para trás.","Volte."],747],["Alongamento de bíceps em pé",["mobilidade"],"mobilidade",[],1,"academia",["Mãos juntas atrás das costas.","Estique os braços e suba-os.","Segure."],749],["Desenvolvimento Bradford em pé",["ombros"],"ombros",["triceps"],2,"barra",["Barra nos ombros.","Suba por cima da cabeça e desça atrás.","Alterne."],750],["Supino na polia em pé",["peito"],"peito",["ombros","triceps"],2,"academia",["Polias na altura do peito.","Empurre as alças à frente.","Volte."],751],["Levantamento diagonal na polia",["abdomen"],"abdomen",["ombros"],2,"academia",["Polia baixa.","Puxe a alça na diagonal para cima girando o tronco.","Volte."],752],["Lenhador na polia",["abdomen"],"abdomen",["ombros"],2,"academia",["Polia alta.","Puxe a alça na diagonal para baixo girando o tronco.","Volte."],753],["Rosca concentrada em pé",["biceps"],"biceps",[],1,"halteres",["Tronco inclinado, braço pendurado.","Suba o halter.","Desça."],755],["Panturrilha em pé com halteres",["panturrilha"],"panturrilha",[],3,"halteres",["Halteres ao lado.","Suba na ponta dos pés.","Desça."],756],["Desenvolvimento em pé com halteres",["ombros"],"ombros",["triceps"],2,"halteres",["Halteres nos ombros.","Empurre para cima.","Desça."],757],["Rosca inversa em pé com halteres",["biceps"],"biceps",[],3,"halteres",["Halteres com palmas para baixo.","Suba.","Desça."],758],["Elevação frontal acima da cabeça com halteres",["ombros"],"ombros",[],3,"halteres",["Halteres à frente das coxas.","Suba os braços retos até acima da cabeça.","Desça."],759],["Alongamento de quadríceps com pé elevado",["mobilidade"],"mobilidade",[],2,"academia",["Pé de trás sobre um banco.","Dobre a perna da frente.","Segure."],762],["Elevação frontal com barra acima da cabeça",["ombros"],"ombros",[],3,"barra",["Barra nas coxas.","Suba com braços retos até acima da cabeça.","Desça."],763],["Alongamento de panturrilha no degrau",["mobilidade"],"mobilidade",[],2,"corpo",["Calcanhar no degrau, joelho reto.","Incline à frente.","Segure."],764],["Alongamento de posterior e panturrilha em pé",["mobilidade"],"mobilidade",[],2,"academia",["Faixa no pé, perna estendida.","Puxe o pé.","Segure."],765],["Círculos de quadril em pé",["mobilidade"],"mobilidade",[],1,"corpo",["Numa perna, segurando um apoio.","Faça círculos com o joelho elevado."],766],["Alongamento de flexores do quadril em pé",["mobilidade"],"mobilidade",[],1,"corpo",["Um pé à frente.","Leve o quadril à frente.","Segure."],767],["Rosca aberta em pé",["biceps"],"biceps",[],3,"halteres",["Halteres apontando para fora.","Suba.","Desça."],768],["Alongamento lateral em pé",["mobilidade"],"mobilidade",[],2,"corpo",["Pés afastados.","Incline o tronco para um lado com o braço acima.","Troque."],769],["Flexora em pé",["pernas"],"posterior",[],1,"academia",["Na máquina, tronco apoiado.","Puxe o calcanhar ao glúteo.","Desça."],770],["Salto em distância",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"corpo",["Pés afastados.","Balance os braços e salte o mais longe possível."],771],["Tríceps unilateral na polia baixa",["triceps"],"triceps",["peito","ombros"],3,"academia",["De costas para a polia baixa, alça atrás da cabeça.","Estenda o braço.","Volte."],773],["Aperto de anilha",["antebraco"],"biceps",[],1,"academia",["Anilha segurada pela borda.","Aperte e segure pelo tempo."],775],["Rosca unilateral na polia",["biceps"],"biceps",[],3,"academia",["Alça da polia baixa numa mão.","Suba.","Desça."],776],["Rosca unilateral sobre banco inclinado",["biceps"],"biceps",[],1,"halteres",["Braço sobre o encosto do banco.","Suba o halter.","Desça."],777],["Tríceps francês unilateral em pé",["triceps"],"triceps",["peito","ombros"],1,"halteres",["Halter acima da cabeça numa mão.","Desça atrás da cabeça.","Estenda."],778],["Tríceps francês com barra em pé",["triceps"],"triceps",["ombros"],1,"barra",["Barra acima da cabeça.","Desça atrás da cabeça.","Estenda."],779],["Desenvolvimento unilateral pegada neutra",["ombros"],"ombros",["triceps"],2,"halteres",["Halter no ombro, palma para dentro.","Empurre para cima.","Desça."],780],["Desenvolvimento em pé pegada neutra",["ombros"],"ombros",["triceps"],3,"halteres",["Halteres nos ombros, palmas para dentro.","Empurre para cima.","Desça."],781],["Rosca de punho atrás das costas",["antebraco"],"biceps",[],1,"barra",["Barra atrás do corpo.","Suba os punhos.","Desça."],782],["Retroversão pélvica em pé",["mobilidade"],"mobilidade",[],1,"corpo",["Joelhos levemente dobrados.","Encaixe o quadril para a frente e volte."],783],["Abdominal em pé na polia",["abdomen"],"abdomen",[],1,"academia",["De costas para a polia alta, corda nos ombros.","Enrole o tronco.","Volte."],784],["Alongamento de sóleo e tendão de Aquiles",["mobilidade"],"mobilidade",[],1,"corpo",["Um pé à frente.","Dobre os joelhos com os calcanhares no chão.","Segure."],785],["Toque nos pés em pé",["mobilidade"],"mobilidade",[],2,"corpo",["Pernas retas.","Incline o tronco e toque os pés.","Volte."],786],["Tríceps com toalha em pé",["triceps"],"triceps",[],1,"corpo",["Toalha acima da cabeça.","Desça atrás e estenda os braços."],787],["Arremesso acima da cabeça em pé",["ombros"],"ombros",["peito","costas"],2,"academia",["Bola acima da cabeça.","Lance à frente com força."],788],["Salto estrela",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],2,"corpo",["Pés juntos.","Salte abrindo braços e pernas."],789],["Subida no banco com elevação de joelho",["gluteos"],"gluteos",["posterior","quadriceps"],2,"corpo",["De frente para o banco.","Suba e eleve o outro joelho.","Desça e alterne."],790],["Escada rolante (step mill)",["cardio"],"cardio",[],3,"academia",["Suba no aparelho.","Suba os degraus num ritmo constante."],791],["Stiff com halteres",["pernas"],"posterior",["gluteos","costas"],2,"halteres",["Halteres ao lado.","Incline o tronco descendo os halteres.","Suba."],793],["Bom dia com pernas retas",["costas"],"costas",["gluteos","posterior"],2,"barra",["Barra nas costas.","Incline o tronco com pernas retas.","Volte."],794],["Vácuo abdominal",["mobilidade"],"mobilidade",[],1,"corpo",["Em pé, solte o ar.","Puxe o umbigo para dentro.","Segure."],795],["Remada com barra sobre o banco",["costas"],"costas",["biceps"],2,"barra",["Em pé no banco.","Puxe a barra até o banco.","Desça."],798],["Elevação reta no inclinado",["ombros"],"ombros",["costas"],1,"barra",["De bruços no inclinado.","Suba a barra à frente com braços retos.","Desça."],799],["Salto com cruzamento na caixa",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],2,"academia",["Um pé na caixa.","Salte cruzando sobre ela."],800],["Terra sumô com elástico",["pernas"],"posterior",["quadriceps","biceps","gluteos"],3,"barra",["Elásticos na barra.","Suba e desça."],802],["Terra sumô com correntes",["pernas"],"posterior",["gluteos","quadriceps","biceps"],3,"barra",["Correntes na barra.","Suba e desça."],803],["Superman",["mobilidade"],"mobilidade",[],2,"corpo",["De bruços, braços estendidos.","Suba braços e pernas juntos.","Desça."],804],["Arremesso de peito deitado",["triceps"],"triceps",["peito","ombros"],2,"academia",["Deitado, bola no peito.","Lance para cima e pegue."],805],["Arremesso unilateral deitado",["abdomen"],"abdomen",["peito","costas","ombros"],2,"academia",["Deitado, bola numa mão.","Lance para cima."],806],["Arremesso acima da cabeça deitado",["abdomen"],"abdomen",["peito","costas","ombros"],2,"academia",["Deitado, bola nas mãos.","Lance por cima da cabeça."],807],["Queda suspensa (fallout)",["abdomen"],"abdomen",["peito","costas","ombros"],3,"academia",["Mãos nas alças.","Incline à frente estendendo os braços.","Volte."],808],["Flexão suspensa",["peito"],"peito",["ombros","triceps"],2,"academia",["Mãos nas alças.","Desça o peito.","Empurre."],809],["Abdominal invertido suspenso",["abdomen"],"abdomen",[],1,"academia",["Pés nas alças, em prancha.","Leve os joelhos ao peito.","Estenda."],810],["Remada suspensa",["costas"],"costas",["biceps"],2,"academia",["Alças na altura do peito, corpo inclinado.","Puxe até as mãos.","Volte."],811],["Agachamento búlgaro suspenso",["pernas"],"quadriceps",["gluteos","panturrilha","posterior"],3,"academia",["Pé de trás na alça.","Desça na perna da frente.","Suba."],812],["Svend press",["peito"],"peito",["biceps","ombros","triceps"],2,"academia",["Duas anilhas apertadas entre as mãos.","Empurre à frente.","Volte."],813],["Tate press",["triceps"],"triceps",["peito","ombros"],3,"halteres",["Deitado, halteres acima.","Desça em direção ao peito com cotovelos abertos.","Estenda."],815],["Alongamento em V (straddle)",["mobilidade"],"mobilidade",[],2,"corpo",["Sentado, pernas abertas em V.","Incline à frente.","Segure."],816],["Cadeira abdutora",["gluteos"],"gluteos",[],1,"academia",["Sentado na máquina.","Abra as pernas.","Volte devagar."],817],["Cadeira adutora",["pernas"],"quadriceps",["gluteos","posterior"],1,"academia",["Sentado na máquina.","Feche as pernas.","Volte devagar."],818],["Virada de pneu",["pernas"],"quadriceps",["panturrilha","peito","biceps"],3,"academia",["Mãos sob o pneu.","Levante e empurre até virar."],819],["Toque nos pés deitado",["mobilidade"],"mobilidade",[],1,"corpo",["Deitado, pernas para cima.","Suba o tronco tocando os pés."],820],["Rotação de tronco com bola",["mobilidade"],"mobilidade",[],2,"academia",["Bola à frente com braços estendidos.","Gire o tronco para os lados."],821],["Corrida ou caminhada em trilha",["cardio"],"cardio",[],2,"corpo",["Corra ou caminhe em trilha num ritmo confortável."],822],["Levantamento terra com barra hexagonal",["pernas"],"quadriceps",["gluteos","posterior"],2,"academia",["Dentro da barra hexagonal.","Suba estendendo quadril e joelhos.","Desça."],823],["Alongamento lateral de tríceps",["mobilidade"],"mobilidade",[],2,"corpo",["Braço cruzando por cima do ombro.","Puxe o cotovelo.","Segure."],825],["Extensão de tríceps acima da cabeça com corda",["triceps"],"triceps",[],1,"academia",["Corda na polia baixa, de costas.","Estenda acima da cabeça.","Volte."],826],["Tríceps na polia com barra V",["triceps"],"triceps",[],1,"academia",["Barra V na polia alta.","Estenda os cotovelos.","Volte."],829],["Alongamento de tríceps",["mobilidade"],"mobilidade",[],1,"corpo",["Mão atrás da cabeça.","Puxe o cotovelo com a outra mão.","Segure."],830],["Abdominal grupado",["abdomen"],"abdomen",[],1,"corpo",["Deitado, joelhos ao peito.","Suba o tronco.","Desça."],831],["Rosca scott com halteres",["biceps"],"biceps",[],1,"halteres",["Braços no scott, halteres.","Suba.","Desça."],832],["Clean com dois kettlebells",["ombros"],"ombros",["panturrilha","gluteos","posterior"],3,"kettlebell",["Kettlebells entre os pés.","Leve aos ombros.","Desça."],833],["Jerk com dois kettlebells",["ombros"],"ombros",["panturrilha","quadriceps","triceps"],3,"kettlebell",["Kettlebells nos ombros.","Empurre acima com impulso.","Desça."],834],["Desenvolvimento militar com dois kettlebells",["ombros"],"ombros",["triceps"],3,"kettlebell",["Kettlebells nos ombros.","Empurre para cima.","Desça."],835],["Remada com dois kettlebells",["costas"],"costas",["biceps"],3,"kettlebell",["Tronco inclinado.","Puxe os kettlebells até o abdômen.","Desça."],836],["Puxada supinada",["costas"],"costas",["biceps","ombros"],2,"academia",["Barra da polia alta, palmas para você.","Puxe até o peito.","Volte."],837],["Alongamento de costas abraçando as pernas",["mobilidade"],"mobilidade",[],2,"corpo",["Sentado, abrace as coxas por baixo.","Arredonde as costas.","Segure."],838],["Alongamento da parte alta das costas",["mobilidade"],"mobilidade",[],2,"corpo",["Dedos entrelaçados à frente.","Arredonde os ombros.","Segure."],839],["Remada alta na polia",["trapezio"],"costas",["ombros"],3,"academia",["Barra da polia baixa.","Puxe até o peito.","Desça."],841],["Remada alta com elástico",["trapezio"],"costas",["ombros"],2,"elastico",["Pise no elástico.","Puxe até o peito.","Desça."],842],["Alongamento para cima",["mobilidade"],"mobilidade",[],2,"corpo",["Mãos unidas acima da cabeça.","Estique para cima.","Segure."],843],["Puxada com triângulo",["costas"],"costas",["biceps","ombros"],3,"academia",["Triângulo na polia alta.","Puxe até o peito.","Volte."],844],["Barra fixa com triângulo",["costas"],"costas",["biceps","ombros"],2,"corpo",["Triângulo sobre a barra.","Puxe até o peito.","Desça."],845],["Swing vertical com halter",["pernas"],"posterior",["gluteos","quadriceps","ombros"],2,"halteres",["Halter entre as pernas.","Balance até acima da cabeça com o quadril."],846],["Caminhada na esteira",["cardio"],"cardio",[],2,"academia",["Suba na esteira.","Caminhe num ritmo confortável."],847],["Hiperextensão na bola",["costas"],"costas",["gluteos","posterior"],3,"academia",["Tronco sobre a bola, pés presos.","Suba o tronco.","Desça."],848],["Flexão lateral na bola",["abdomen"],"abdomen",[],3,"academia",["De lado na bola.","Suba o tronco lateralmente.","Desça."],849],["Tríceps banco com carga",["triceps"],"triceps",["peito","ombros"],3,"academia",["Mãos num banco, pés em outro, peso no colo.","Desça e suba."],850],["Abdominal com carga",["abdomen"],"abdomen",[],1,"academia",["Deitado, anilha no peito.","Tire os ombros do chão.","Desça."],851],["Agachamento com salto com carga",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra leve nas costas.","Agache e salte."],852],["Barra fixa com carga",["costas"],"costas",["biceps"],3,"academia",["Peso preso no cinto.","Puxe até o queixo passar.","Desça."],853],["Agachamento sissy com carga",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Peso no peito, segurando um apoio.","Incline para trás dobrando os joelhos.","Suba."],854],["Abdominal com elástico",["abdomen"],"abdomen",[],3,"academia",["Elástico preso no banco declinado.","Suba o tronco.","Desça."],855],["Agachamento com cinto de carga",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"academia",["Em pé sobre dois bancos, peso no cinto.","Agache.","Suba."],856],["Supino reto pegada aberta",["peito"],"peito",["ombros","triceps"],3,"barra",["Barra com pegada aberta.","Desça até o peito.","Empurre."],857],["Supino declinado pegada aberta",["peito"],"peito",["ombros","triceps"],3,"barra",["No declinado, pegada aberta.","Desça e empurre."],858],["Pullover declinado com barra",["peito"],"peito",["ombros","triceps"],3,"barra",["No declinado, barra acima do peito.","Leve atrás da cabeça.","Volte."],859],["Puxada por trás da nuca",["costas"],"costas",["biceps","ombros"],3,"academia",["Barra larga.","Puxe até a nuca.","Volte."],861],["Barra fixa aberta por trás",["costas"],"costas",["biceps","ombros"],3,"corpo",["Pegada aberta.","Puxe até a nuca passar da barra.","Desça."],862],["Rosca direta pegada aberta",["biceps"],"biceps",[],1,"barra",["Barra com pegada aberta.","Suba.","Desça."],863],["Agachamento com base aberta",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],3,"barra",["Barra nas costas, pés afastados.","Agache.","Suba."],864],["Stiff com base aberta",["pernas"],"posterior",["quadriceps","gluteos","costas"],3,"barra",["Pés afastados.","Desça a barra com pernas quase retas.","Suba."],865],["Sprint pendurado",["abdomen"],"abdomen",[],2,"corpo",["Pendurado na barra.","Leve os joelhos ao peito alternando rápido."],866],["Moinho deitado",["mobilidade"],"mobilidade",[],3,"corpo",["Deitado, braços abertos.","Leve uma perna até a mão oposta.","Alterne."],867],["Melhor alongamento do mundo",["mobilidade"],"mobilidade",[],3,"corpo",["Em afundo, mão no chão.","Gire o tronco abrindo o braço.","Troque."],868],["Círculos com os punhos",["mobilidade"],"mobilidade",[],1,"corpo",["Braços à frente.","Gire os punhos.","Inverta."],869],["Rotação de punhos com barra",["antebraco"],"biceps",[],1,"barra",["Barra nas mãos.","Gire os punhos."],871],["Caminhada com yoke",["pernas"],"quadriceps",["abdomen","gluteos","panturrilha"],3,"academia",["Yoke nas costas.","Ande com passos curtos."],872],["Agachamento Zercher",["pernas"],"quadriceps",["panturrilha","gluteos","posterior"],5,"barra",["Barra na dobra dos cotovelos.","Agache.","Suba."],873],["Rosca Zottman no scott",["biceps"],"biceps",[],3,"halteres",["Braços no scott.","Suba com palmas para cima e desça com palmas para baixo."],875]];
const FEDB_SITE = {"Rosca direta com barra reta ou W":[["Em pé, barra com pegada na largura dos ombros, palmas para a frente.","Suba a barra sem mexer os cotovelos.","Desça devagar."],44],"Rosca simultânea":[["Em pé, halteres ao lado do corpo.","Suba os dois juntos girando as palmas para cima.","Desça devagar."],223],"Rosca direta na polia":[["Barra da polia baixa.","Suba sem mexer os cotovelos.","Desça."],748],"Rosca concentrada":[["Sentado, cotovelo apoiado na parte interna da coxa.","Suba o halter.","Desça devagar."],180],"Rosca inclinada":[["Sentado no inclinado, halteres pendurados.","Suba sem mexer os cotovelos.","Desça devagar."],340],"Rosca spider":[["Peito apoiado no banco scott ou inclinado.","Suba a barra.","Desça."],729],"Rosca alternada":[["Em pé, halteres ao lado do corpo.","Suba um halter girando a palma para cima, cotovelo parado.","Desça e alterne."],220],"Barra fixa supinada (chin up)":[["Palmas para você, pegada mais fechada que os ombros.","Puxe até o queixo passar da barra.","Desça devagar."],159],"Rosca scott":[["Braços no banco scott, barra W.","Suba a barra.","Desça devagar."],556],"Rosca martelo":[["Halteres com palmas para dentro.","Suba sem mexer os cotovelos.","Desça."],308],"Rosca arrastada (drag curl)":[["Barra com palmas para a frente, cotovelos para trás.","Suba a barra rente ao corpo.","Desça devagar."],218],"Rosca Zottman":[["Suba com palmas para cima.","Gire no alto e desça com palmas para baixo."],874],"Tríceps corda":[["Corda na polia alta.","Estenda os cotovelos abrindo a corda.","Volte devagar."],828],"Tríceps francês":[["Halter acima da cabeça com as duas mãos.","Desça atrás da cabeça.","Estenda."],760],"Tríceps com barra reta ou W":[["Barra na polia alta.","Estenda os cotovelos.","Volte devagar."],827],"Supino fechado":[["Deitado, pegada na largura dos ombros.","Desça a barra até o peito com cotovelos rentes.","Empurre até estender."],170],"Tríceps invertido":[["Barra da polia alta com palmas para cima.","Estenda os cotovelos.","Volte."],594],"Paralelas":[["Entre as barras paralelas.","Desça dobrando os cotovelos.","Suba empurrando."],534],"Flexão diamante":[["Mãos próximas.","Desça com cotovelos rentes.","Empurre."],564],"Tríceps banco":[["Mãos no banco atrás de você, pernas estendidas.","Desça dobrando os cotovelos até 90°.","Suba estendendo os braços."],70],"Tríceps coice":[["Tronco inclinado, braço colado.","Estenda para trás.","Volte."],824],"Tríceps testa":[["Deitado, barra W com pegada fechada.","Desça até a testa.","Estenda."],253],"Supino inclinado":[["Deitado no banco inclinado, barra com pegada média.","Desça até a parte alta do peito.","Empurre até estender."],52],"Supino reto":[["Deitado no banco, barra com pegada média.","Desça a barra até o meio do peito.","Empurre até estender os braços."],43],"Supino declinado (canadense)":[["Pernas presas no banco declinado.","Desça a barra até a parte baixa do peito.","Empurre de volta."],194],"Crucifixo":[["Deitado no banco, halteres acima do peito.","Abra os braços com cotovelos levemente dobrados.","Junte de volta."],226],"Supino máquina":[["Sentado na máquina.","Empurre as alças à frente.","Volte."],458],"Pullover com halteres":[["Deitado, halter acima do peito.","Leve para trás da cabeça com braços retos.","Volte."],796],"Voador ou peck deck":[["Sentado, braços nos apoios na altura dos ombros.","Junte os braços à frente do peito.","Volte devagar."],108],"Flexão de braço":[["Mãos um pouco mais abertas que os ombros.","Desça o peito perto do chão.","Empurre."],570],"Desenvolvimento com barra":[["Barra nos ombros.","Empurre acima da cabeça.","Desça."],774],"Desenvolvimento com halteres":[["Sentado com encosto, halteres nos ombros.","Empurre para cima até estender.","Desça devagar."],243],"Desenvolvimento Arnold":[["Sentado, halteres à frente do peito com palmas para você.","Suba girando as palmas para a frente até estender.","Desça fazendo o caminho inverso."],25],"Elevação lateral com halteres":[["Em pé, halteres ao lado.","Suba até a linha dos ombros.","Desça devagar."],667],"Elevação lateral na polia":[["De lado para a polia baixa.","Suba o braço até o ombro.","Desça."],772],"Elevação frontal com halteres":[["Halteres à frente das coxas.","Suba um braço à frente até o ombro.","Desça e alterne."],289],"Elevação lateral inclinada":[["Deitado de lado no inclinado.","Suba o braço até a vertical.","Desça."],488],"Remada alta com barra":[["Barra com pegada fechada.","Puxe até o peito com cotovelos altos.","Desça."],840],"Remada alta com halteres":[["Halteres à frente das coxas.","Puxe até o peito com cotovelos altos.","Desça."],761],"Face pull":[["Corda na polia alta.","Puxe em direção ao rosto abrindo as mãos.","Volte devagar."],266],"Voador invertido":[["Peito no apoio.","Abra os braços para trás.","Volte."],596],"Crucifixo invertido com halteres":[["Sentado, tronco inclinado sobre as coxas.","Abra os braços para os lados.","Desça."],625],"Encolhimento":[["Em pé, halteres ao lado.","Suba os ombros em direção às orelhas.","Desça devagar."],244],"Encolhimento por trás do corpo":[["Em pé, barra atrás do corpo.","Suba os ombros em direção às orelhas.","Desça devagar."],60],"Levantamento terra":[["Barra sobre o meio dos pés, costas retas, pegada na largura dos ombros.","Suba estendendo quadril e joelhos ao mesmo tempo.","Desça controlando a barra rente às pernas."],46],"Elevação em Y":[["Halteres leves, braços ao lado.","Suba os braços na diagonal até a altura dos ombros.","Desça devagar."],240],"Barra fixa":[["Pegada pronada.","Puxe até o queixo passar da barra.","Desça devagar."],562],"Pulley costas":[["Barra larga na polia alta.","Puxe até o alto do peito.","Volte."],860],"Remada curvada":[["Tronco inclinado, costas retas, pegada pronada.","Puxe a barra até o abdômen.","Desça controlando."],79],"Remada serrote":[["Joelho e mão no banco.","Puxe o halter até o quadril.","Desça."],485],"Pull down":[["Barra da polia alta.","Puxe até as coxas com braços retos.","Volte."],797],"Remada baixa":[["Triângulo na polia baixa.","Puxe até o abdômen juntando as escápulas.","Volte."],628],"Remada cavalinho":[["Barra presa no canto, alça encaixada.","Puxe até o peito.","Desça."],814],"Rosca punho":[["Antebraços nas coxas, palmas para cima.","Suba os punhos.","Desça."],652],"Rosca punho invertida":[["Antebraços nas coxas, palmas para baixo.","Suba os punhos.","Desça."],653],"Rosca inversa":[["Barra com palmas para baixo.","Suba sem mexer os cotovelos.","Desça."],587],"Rolo de punho":[["Braços estendidos à frente.","Enrole a corda girando os punhos.","Desenrole devagar."],870],"Abdominal reto (tradicional)":[["Deitado, joelhos dobrados.","Tire os ombros do chão contraindo o abdômen.","Desça devagar."],188],"Abdominal na polia":[["De joelhos sob a polia alta, corda junto ao rosto.","Enrole o tronco levando o peito ao quadril.","Volte devagar."],111],"Abdominal infra nas paralelas":[["Antebraços nas paralelas.","Suba os joelhos ao peito.","Desça devagar."],392],"Prancha abdominal":[["Apoie antebraços e ponta dos pés.","Corpo reto, abdômen e glúteos contraídos.","Segure."],541],"Abdominal na máquina":[["Escolha carga leve, pés sob os apoios e mãos nas alças de cima.","Enrole o tronco aproximando o peito dos joelhos.","Volte devagar sem soltar o peso."],2],"Abdominal tesoura":[["Deitado, mãos sob o glúteo.","Cruze as pernas estendidas alternando."],619],"Abdominal remador":[["Deitado, braços acima da cabeça e pernas retas.","Leve joelhos ao peito e braços em volta deles.","Volte estendendo."],178],"Abdominal infra no solo":[["Deitado, mãos ao lado.","Leve os joelhos ao peito tirando o quadril.","Desça devagar."],590],"Abdominal cruzado":[["Deitado, joelhos dobrados, mãos atrás da cabeça.","Leve um ombro em direção ao joelho oposto.","Alterne os lados."],181],"Roda abdominal":[["De joelhos, segure a roda no chão à frente.","Role para a frente alongando o corpo sem a lombar afundar.","Puxe de volta contraindo o abdômen."],3],"Abdominal declinado":[["Pernas presas no banco declinado.","Suba o tronco contraindo o abdômen.","Desça devagar."],196],"Abdominal oblíquo":[["Deitado de lado.","Suba o tronco lateralmente.","Desça e troque."],481],"Agachamento livre":[["Barra nas costas, pés na largura dos ombros.","Desça até as coxas ficarem paralelas ao chão.","Suba empurrando com os calcanhares."],63],"Agachamento frontal":[["Barra na frente dos ombros, cotovelos altos.","Desça até as coxas paralelas.","Suba."],284],"Agachamento búlgaro":[["Pé de trás num banco, halteres nas mãos.","Desça na perna da frente.","Suba."],735],"Leg press":[["Pés na plataforma na largura dos ombros.","Desça dobrando os joelhos até 90°.","Empurre sem travar os joelhos."],414],"Agachamento hack":[["Costas no apoio, ombros sob as almofadas.","Desça até 90°.","Suba."],307],"Stiff":[["Barra nas mãos, joelhos quase retos.","Incline o tronco descendo a barra.","Suba."],792],"Levantamento terra romeno":[["Barra nas mãos, joelhos levemente dobrados.","Leve o quadril para trás descendo a barra rente às pernas.","Suba."],606],"Agachamento goblet":[["Kettlebell ou halter junto ao peito.","Agache entre as pernas.","Suba."],301],"Afundo":[["Halteres ao lado do corpo.","Dê um passo à frente e desça até o joelho de trás quase tocar o chão.","Volte e alterne."],229],"Elevação pélvica com barra":[["Costas apoiadas no banco, barra sobre o quadril.","Suba o quadril até alinhar com o tronco, apertando os glúteos.","Desça devagar."],51],"Cadeira extensora":[["Sentado na máquina.","Estenda as pernas.","Desça devagar."],412],"Mesa flexora":[["Deitado de bruços na máquina.","Puxe os calcanhares ao glúteo.","Desça devagar."],450],"Levantamento terra sumô":[["Pés bem afastados, mãos por dentro das pernas.","Suba estendendo quadril e joelhos.","Desça."],801],"Flexão nórdica":[["Pés presos, de joelhos.","Desça o tronco devagar.","Volte com o posterior."],477],"Good morning":[["Barra nas costas.","Incline o tronco levando o quadril para trás.","Volte estendendo o quadril."],302],"Agachamento sumô":[["Pés bem afastados, halter entre as pernas.","Agache.","Suba."],545],"Elevação de panturrilhas em pé na máquina":[["Ombros sob os apoios, ponta dos pés na plataforma.","Suba na ponta dos pés.","Desça alongando."],754],"Elevação de panturrilhas no leg press":[["Ponta dos pés na borda da plataforma do leg press.","Empurre estendendo os tornozelos.","Volte alongando."],135],"Elevação de panturrilhas com barra livre":[["Barra nas costas, ponta dos pés num bloco.","Suba na ponta dos pés.","Desça."],744],"Elevação de panturrilhas sentado na máquina":[["Ponta dos pés na plataforma, joelhos sob o apoio.","Suba os calcanhares.","Desça alongando."],630],"Elevação de panturrilhas sentado com halteres":[["Sentado, ponta do pé num bloco, halter sobre o joelho.","Suba o calcanhar.","Desça e troque."],242],"Passada":[["Mãos na cintura.","Dê passos à frente descendo até o joelho de trás quase tocar o chão.","Continue alternando."],95],"Extensão do quadril na polia":[["Tornozeleira na polia baixa.","Leve a perna para trás.","Volte e troque."],507]};
const SITE_SET = new Set(SITE_LIB.map(e => e[0].toLowerCase()));
const LIBRARY = [
  ...SITE_LIB.map(([nome,cats,musc,sec,nivel,equip,dica]) => { const f = FEDB_SITE[nome]; return f ? {nome,cats,musc,sec,nivel,equip,dica,passos:f[0],img:f[1]} : {nome,cats,musc,sec,nivel,equip,dica}; }),
  ...FEDB_LIB.filter(e => !SITE_SET.has(e[0].toLowerCase())).map(([nome,cats,musc,sec,nivel,equip,passos,img]) => ({nome,cats,musc,sec,nivel,equip,dica:passos[1] || passos[0] || "",passos,img,fedb:true})),
  ...OLD_LIB.filter(e => !SITE_SET.has(e.nome.toLowerCase())).map(e => e.musc === "cardio" || e.musc === "mobilidade" ? { ...e, cats:[e.musc] } : { ...e, hidden:true })
];
const catsOf = e => e.cats || (e.hidden ? [] : [({ quadriceps:"pernas", posterior:"pernas" })[e.musc] || e.musc]);
const libVis = () => LIBRARY.filter(e => !e.hidden);
const LIBMAP = new Map(LIBRARY.map(e => [e.nome.toLowerCase(), e]));
const INFER = [
 [/tr[ií]ceps|franc[eê]s|testa|coice(?! de gl)|mergulho no banco|diamante/,"triceps"],[/rosca|b[ií]ceps|scott/,"biceps"],
 [/supino|crucifixo|crossover|flex[aã]o(?! pike)|peck|voador|peito/,"peito"],[/remada|puxada|barra fixa|pull ?down|pulley|encolhimento|pullover|costas|terra(?! romeno)|superman|dorsa/,"costas"],
 [/desenvolvimento|eleva[cç][aã]o (lateral|frontal)|ombro|face pull|pike|arnold/,"ombros"],[/panturrilha|g[eê]meos/,"panturrilha"],
 [/abdominal|prancha|hollow|crunch|core|roda|eleva[cç][aã]o de pernas|oblíquo/,"abdomen"],[/p[eé]lvica|gl[uú]teo|abdu[cç]|ponte|coice de gl/,"gluteos"],
 [/stiff|romeno|flexora|posterior|bom dia|good morning|n[oó]rdica|swing/,"posterior"],[/agachamento|leg press|extensora|afundo|avan[cç]o|passada|hack|b[uú]lgaro|step/,"quadriceps"],
 [/esteira|bike|bicicleta erg|corrida|caminhada|burpee|polichinelo|corda|mountain|cardio|el[ií]ptico|remo erg|sprint|hiit/,"cardio"],
 [/alongamento|mobilidade|rota[cç][aã]o|gato|yoga|respira/,"mobilidade"]];
function infoOf(ex){
  const name = typeof ex === "string" ? ex : ex.nome, lib = LIBMAP.get(String(name).toLowerCase());
  if (lib) return lib;
  const n = String(name).toLowerCase(), hit = INFER.find(([r]) => r.test(n));
  const musc = (ex.musculo && (MUSC[ex.musculo] || EXTRA[ex.musculo])) ? ex.musculo : hit ? hit[1] : "abdomen";
  return { nome:name, musc, sec:[], nivel: +ex.nivel || (/barra|terra|agachamento livre/.test(n) ? 3 : 2), equip:"", dica: ex.dica || "" };
}

/* ---------- ilustrações dos exercícios ---------- */
const ST = { S:[60,32], H:[60,62], K:[60,85], F:[60,108], E:[63,48], W:[65,64] };
const HINGE_LOW = { S:[84,48], H:[52,62], K:[58,85], F:[60,108] };
const BENCH = { t:"bench", x1:20, x2:82, y:88 };
const POSES = {
  squat:{ A:{...ST, K:[61,85], E:[70,40], W:[62,30]}, B:{S:[72,58],H:[54,84],K:[78,90],F:[60,108],E:[82,66],W:[74,56]}, props:[{t:"plate"}] },
  goblet:{ A:{...ST, E:[68,46], W:[66,38]}, B:{S:[72,58],H:[54,84],K:[78,90],F:[60,108],E:[82,72],W:[80,62]}, props:[{t:"db"}] },
  lunge:{ A:{...ST, S:[58,32], H:[58,62], K2:[58,85], F2:[56,108], E:[58,48], W:[58,64]}, B:{S:[56,52],H:[56,80],K:[78,86],F:[78,108],K2:[48,104],F2:[30,106],E:[56,66],W:[56,80]}, props:[{t:"db"}] },
  hinge:{ A:{...ST}, B:{...HINGE_LOW, E:[84,64], W:[84,80]}, props:[{t:"plate"}] },
  swing:{ A:{S:[84,50],H:[52,62],K:[62,84],F:[60,108],E:[76,64],W:[64,74]}, B:{...ST, E:[72,34], W:[86,34]}, props:[{t:"kb"}] },
  thrust:{ A:{S:[28,94],H:[56,104],K:[74,88],F:[84,108],E:[40,102],W:[54,102]}, B:{S:[28,94],H:[56,84],K:[78,80],F:[84,108],E:[40,96],W:[54,86]}, props:[{t:"bench",x1:6,x2:32,y:96},{t:"plate"}] },
  bench:{ A:{S:[36,82],H:[66,82],K:[86,84],F:[90,108],E:[36,68],W:[36,54]}, B:{S:[36,82],H:[66,82],K:[86,84],F:[90,108],E:[24,86],W:[36,74]}, props:[BENCH,{t:"plate"}] },
  pushup:{ A:{S:[36,84],H:[66,94],K:[84,100],F:[102,106],E:[36,96],W:[36,107]}, B:{S:[38,99],H:[67,102],K:[85,104],F:[102,106],E:[52,96],W:[36,107]}, props:[] },
  press:{ A:{...ST, E:[72,40], W:[66,28]}, B:{...ST, E:[64,16], W:[62,2]}, props:[{t:"db"}] },
  row:{ A:{...HINGE_LOW, E:[84,64], W:[84,80]}, B:{...HINGE_LOW, E:[70,40], W:[76,56]}, props:[{t:"plate"}] },
  rowStand:{ A:{S:[56,34],H:[56,64],K:[62,86],F:[60,108],E:[72,38],W:[88,40]}, B:{S:[56,34],H:[56,64],K:[62,86],F:[60,108],E:[42,44],W:[58,42]}, props:[{t:"cable",to:[118,40]},{t:"handle"}] },
  pulldown:{ A:{S:[58,44],H:[56,74],K:[80,76],F:[82,100],E:[60,28],W:[62,12]}, B:{S:[58,44],H:[56,74],K:[80,76],F:[82,100],E:[48,58],W:[56,42]}, props:[{t:"seat",x1:40,x2:66,y:76},{t:"cable",to:[62,0]},{t:"lbar"}] },
  pullup:{ A:{W:[60,12],E:[60,26],S:[60,40],H:[60,70],K:[58,92],F:[56,112]}, B:{W:[60,12],E:[50,24],S:[60,32],H:[60,62],K:[58,84],F:[56,104]}, props:[{t:"bar",y:12,x1:34,x2:86}], noFloor:true },
  dips:{ A:{S:[60,32],E:[60,48],W:[60,62],H:[58,64],K:[56,86],F:[70,98]}, B:{S:[60,46],E:[48,54],W:[60,62],H:[58,78],K:[56,100],F:[70,110]}, props:[{t:"bar",y:62,x1:44,x2:80}], noFloor:true },
  pullover:{ A:{S:[36,82],H:[66,82],K:[86,84],F:[90,108],E:[22,78],W:[8,76]}, B:{S:[36,82],H:[66,82],K:[86,84],F:[90,108],E:[36,66],W:[36,52]}, props:[BENCH,{t:"db"}] },
  curl:{ A:{...ST}, B:{...ST, W:[72,35]}, props:[{t:"db"}] },
  pushdown:{ A:{...ST, E:[62,50], W:[76,42]}, B:{...ST, E:[62,50], W:[64,68]}, props:[{t:"cable",to:[92,0]},{t:"handle"}] },
  fly:{ front:true, A:{S:[72,32],H:[66,62],K:[66,85],F:[66,108],E:[88,36],W:[104,40]}, B:{S:[72,32],H:[66,62],K:[66,85],F:[66,108],E:[80,42],W:[63,44]}, props:[] },
  lateral:{ front:true, A:{S:[72,32],H:[66,62],K:[66,85],F:[66,108],E:[75,48],W:[75,64]}, B:{S:[72,32],H:[66,62],K:[66,85],F:[66,108],E:[88,32],W:[104,32]}, props:[{t:"db"}] },
  jack:{ front:true, A:{S:[72,32],H:[66,62],K:[66,85],F:[66,108],E:[75,48],W:[75,64]}, B:{S:[72,32],H:[66,62],K:[74,85],F:[82,108],E:[86,22],W:[80,6]}, props:[] },
  plank:{ A:{S:[36,90],H:[66,96],K:[84,100],F:[102,106],E:[36,106],W:[52,106]}, B:{S:[36,89],H:[66,94],K:[84,100],F:[102,106],E:[36,106],W:[52,106]}, props:[] },
  crunch:{ A:{S:[32,104],H:[62,104],K:[78,88],F:[92,106],E:[30,94],W:[24,100]}, B:{S:[40,86],H:[62,104],K:[78,88],F:[92,106],E:[38,76],W:[30,82]}, props:[] },
  legraise:{ A:{W:[60,10],E:[60,24],S:[60,38],H:[60,68],K:[60,90],F:[60,110]}, B:{W:[60,10],E:[60,24],S:[60,38],H:[60,68],K:[82,64],F:[102,62]}, props:[{t:"bar",y:10,x1:34,x2:86}], noFloor:true },
  calf:{ A:{...ST, T:[70,108]}, B:{S:[60,24],H:[60,54],K:[60,77],F:[61,100],E:[60,40],W:[60,56],T:[70,108]}, props:[{t:"step"}] },
  legext:{ A:{S:[50,44],H:[54,76],K:[78,78],F:[80,100],E:[54,60],W:[62,74]}, B:{S:[50,44],H:[54,76],K:[78,78],F:[100,72],E:[54,60],W:[62,74]}, props:[{t:"seat",x1:38,x2:80,y:80}] },
  legcurl:{ A:{S:[30,82],H:[60,84],K:[84,86],F:[106,88],E:[30,96],W:[40,90]}, B:{S:[30,82],H:[60,84],K:[84,86],F:[90,66],E:[30,96],W:[40,90]}, props:[{t:"seat",x1:20,x2:88,y:90}] },
  legpress:{ A:{S:[22,70],H:[42,92],K:[56,70],F:[78,62],E:[30,84],W:[40,92]}, B:{S:[22,70],H:[42,92],K:[62,80],F:[86,66],E:[30,84],W:[40,92]}, props:[{t:"seat",x1:14,x2:50,y:96},{t:"platform"}] },
  run:{ A:{S:[62,32],H:[60,62],K:[72,80],F:[62,100],K2:[52,84],F2:[40,96],E:[54,46],W:[64,52],E2:[70,46],W2:[78,36]}, B:{S:[62,32],H:[60,62],K:[52,84],F:[40,96],K2:[72,80],F2:[62,100],E:[70,46],W:[78,36],E2:[54,46],W2:[64,52]}, props:[] },
  stretch:{ A:{...ST, E:[60,18], W:[60,4]}, B:{S:[82,56],H:[56,62],K:[58,85],F:[60,108],E:[78,74],W:[70,92]}, props:[], slow:true }
};
const HOW = {
  squat:["Pés na largura dos ombros, pontas levemente para fora.","Leve o quadril para trás e para baixo, joelhos na direção dos pés, até a coxa ficar paralela ao chão.","Empurre o chão com o pé inteiro e suba soltando o ar.","Erro comum: deixar os joelhos caírem para dentro ou tirar o calcanhar do chão."],
  goblet:["Segure o peso colado no peito, cotovelos apontando para baixo.","Desça sentando entre as pernas, peito aberto.","Suba empurrando o chão com os calcanhares.","Erro comum: curvar as costas ou deixar o peso afastar do corpo."],
  lunge:["Fique em pé, tronco reto e abdômen firme.","Dê um passo longo e desça até o joelho de trás quase tocar o chão.","Empurre com a perna da frente para voltar.","Erro comum: joelho da frente passar muito à frente da ponta do pé."],
  hinge:["Pés na largura do quadril, peso perto do corpo.","Empurre o quadril para trás com coluna neutra, joelhos levemente flexionados, até sentir alongar atrás da coxa.","Volte contraindo glúteos e posterior.","Erro comum: arredondar a lombar ou dobrar demais os joelhos."],
  swing:["Kettlebell entre as pernas, quadril para trás.","Projete o quadril à frente com força, o peso sobe até a altura do peito.","Deixe descer controlando e repita no ritmo.","Erro comum: levantar com os braços em vez do quadril."],
  thrust:["Costas apoiadas, pés firmes no chão, joelhos a 90° no topo.","Suba o quadril contraindo bem os glúteos.","Segure 1 segundo e desça controlando.","Erro comum: arquear a lombar no topo em vez de contrair o glúteo."],
  bench:["Deite com olhos sob a barra, escápulas juntas e pés firmes.","Desça o peso controlando até a linha do peito.","Empurre para cima soltando o ar, sem travar os cotovelos.","Erro comum: abrir demais os cotovelos ou tirar o quadril do banco."],
  pushup:["Mãos um pouco mais largas que os ombros, corpo em linha reta.","Desça o peito até quase tocar o chão, cotovelos a 45° do corpo.","Empurre o chão e volte estendendo os braços.","Erro comum: quadril caindo ou empinando."],
  press:["Peso na altura dos ombros, abdômen e glúteos firmes.","Empurre para cima até quase estender os braços.","Desça controlando até a altura do queixo.","Erro comum: arquear as costas para trás ao empurrar."],
  row:["Incline o tronco a uns 45°, coluna neutra, joelhos levemente dobrados.","Puxe o peso em direção ao quadril levando os cotovelos para trás.","Junte as escápulas no fim e desça devagar.","Erro comum: puxar com os braços e balançar o tronco."],
  rowStand:["Peito aberto, ombros para baixo, braços estendidos à frente.","Puxe levando os cotovelos para trás, rentes ao corpo.","Junte as escápulas, segure 1 segundo e volte devagar.","Erro comum: jogar o tronco para trás para ajudar."],
  pulldown:["Sente com as coxas presas, pegada um pouco mais larga que os ombros.","Puxe a barra até a altura do queixo levando os cotovelos para baixo.","Suba controlando até esticar os braços.","Erro comum: puxar atrás da nuca ou balançar o corpo."],
  pullup:["Segure a barra com os braços estendidos, ombros ativos.","Puxe o corpo até o queixo passar da barra.","Desça devagar até estender os braços.","Erro comum: balançar as pernas para ganhar impulso."],
  dips:["Apoie as mãos nas barras com os braços estendidos.","Desça dobrando os cotovelos até uns 90°.","Empurre para subir sem travar os cotovelos.","Erro comum: descer demais e forçar o ombro."],
  pullover:["Deite com o peso acima do peito, braços quase estendidos.","Leve o peso para trás da cabeça até sentir alongar.","Volte pelo mesmo caminho até acima do peito.","Erro comum: dobrar muito os cotovelos e virar um tríceps."],
  curl:["Em pé, cotovelos colados ao corpo, palmas para frente.","Suba o peso dobrando só o cotovelo.","Desça devagar até quase estender o braço.","Erro comum: balançar o tronco ou mover os cotovelos para frente."],
  pushdown:["Cotovelos colados ao corpo, tronco levemente inclinado.","Estenda os braços até o fim, empurrando para baixo.","Volte devagar sem deixar os cotovelos subirem.","Erro comum: usar o peso do corpo e abrir os cotovelos."],
  fly:["Braços abertos, cotovelos levemente dobrados.","Feche os braços à frente do peito como num abraço.","Volte abrindo devagar até sentir alongar o peito.","Erro comum: dobrar e esticar o cotovelo, virando um supino."],
  lateral:["Em pé, pesos ao lado do corpo, cotovelos levemente dobrados.","Eleve os braços para os lados até a linha dos ombros.","Desça devagar, sem deixar o peso cair.","Erro comum: subir acima dos ombros ou balançar o corpo."],
  jack:["Em pé, pés juntos e braços ao lado do corpo.","Salte abrindo as pernas e levando os braços acima da cabeça.","Salte de volta à posição inicial e mantenha o ritmo.","Erro comum: aterrissar com os calcanhares e travar os joelhos."],
  plank:["Antebraços no chão, cotovelos sob os ombros.","Corpo em linha reta da cabeça aos pés, abdômen e glúteos contraídos.","Segure respirando normalmente pelo tempo indicado.","Erro comum: deixar o quadril cair ou subir demais."],
  crunch:["Deitado, joelhos dobrados, mãos ao lado da cabeça.","Enrole o tronco tirando as escápulas do chão, soltando o ar.","Desça devagar sem relaxar totalmente.","Erro comum: puxar o pescoço com as mãos."],
  legraise:["Pendurado na barra, corpo parado.","Suba as pernas contraindo o abdômen até a altura do quadril.","Desça devagar sem balançar.","Erro comum: usar impulso do balanço."],
  calf:["Ponta dos pés num degrau, calcanhares para fora.","Suba o máximo que conseguir na ponta dos pés.","Desça devagar até sentir alongar a panturrilha.","Erro comum: fazer rápido e sem amplitude."],
  legext:["Sente com as costas apoiadas e o rolo acima do tornozelo.","Estenda as pernas até ficarem retas.","Segure 1 segundo e desça devagar.","Erro comum: tirar o quadril do banco ou descer soltando o peso."],
  legcurl:["Deite de bruços com o rolo acima do calcanhar.","Dobre os joelhos trazendo os calcanhares em direção ao glúteo.","Volte devagar até quase estender.","Erro comum: levantar o quadril do banco."],
  legpress:["Costas e quadril apoiados, pés no meio da plataforma.","Desça dobrando os joelhos até uns 90°.","Empurre a plataforma sem travar os joelhos no fim.","Erro comum: tirar o quadril do banco ao descer demais."],
  run:["Comece num ritmo leve para aquecer.","Mantenha o tronco alto e os braços soltos acompanhando as pernas.","Ajuste a intensidade: forte nos tiros, leve na recuperação.","Erro comum: começar forte demais e não aguentar o tempo todo."],
  stretch:["Comece em pé, respirando fundo.","Leve o corpo devagar até sentir alongar, sem dor.","Segure 20 a 30 segundos respirando e volte devagar.","Erro comum: forçar com balanços."]
};
function patternOf(ex){
  const n = String(ex.nome || ex).toLowerCase(), m = infoOf(ex).musc;
  const R = [[/panturrilha/,"calf"],[/infra nas paralelas/,"legraise"],[/n[oó]rdica|good morning/,"hinge"],[/tr[ií]ceps banco|paralelas/,"dips"],[/suspens[aã]o na barra/,"pullup"],[/eleva[cç][aã]o em y/,"lateral"],[/leg press/,"legpress"],[/goblet|sumô/,"goblet"],[/agachamento|hack/,"squat"],[/afundo|búlgaro|avan[cç]o|passada|step/,"lunge"],[/swing/,"swing"],[/terra|stiff|romeno|bom dia/,"hinge"],
    [/p[eé]lvica|ponte/,"thrust"],[/pullover/,"pullover"],[/supino/,"bench"],[/burpee|flex[aã]o/,"pushup"],[/mergulho/,"dips"],[/desenvolvimento|press/,"press"],
    [/remada (curvada|unilateral|serrote)/,"row"],[/remada|face pull|encolhimento/,"rowStand"],[/puxada|pull ?down|pulley/,"pulldown"],[/barra fixa/,"pullup"],[/rosca/,"curl"],
    [/tr[ií]ceps|franc[eê]s|testa|coice/,"pushdown"],[/crucifixo|crossover|voador|peck/,"fly"],[/eleva[cç][aã]o (lateral|frontal)|abdu[cç]|caminhada lateral/,"lateral"],
    [/polichinelo/,"jack"],[/prancha|hollow|superman|roda/,"plank"],[/abdominal/,"crunch"],[/eleva[cç][aã]o de pernas/,"legraise"],[/panturrilha/,"calf"],
    [/extensora/,"legext"],[/flexora/,"legcurl"],[/esteira|corrida|bike|corda|mountain|sprint|caminhada|el[ií]ptico/,"run"],[/alongamento|mobilidade|rota[cç][aã]o|gato/,"stretch"]];
  const hit = R.find(([r]) => r.test(n)); if (hit) return hit[1];
  return ({ peito:"bench", costas:"rowStand", ombros:"press", biceps:"curl", triceps:"pushdown", quadriceps:"squat", posterior:"hinge", gluteos:"thrust", panturrilha:"calf", abdomen:"crunch", cardio:"run", mobilidade:"stretch" })[m] || "squat";
}
const lerp = (a,b,t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
function poseAt(P, t){ const o = {}; for (const k in P.A) o[k] = P.B[k] ? lerp(P.A[k], P.B[k], t) : P.A[k]; for (const k in P.B) if (!o[k]) o[k] = P.B[k]; return o; }
function figSVG(key, t, opts = {}){
  const P = POSES[key] || POSES.squat, j = poseAt(P, t), fg = "var(--fg)", mu = "var(--muted)", ac = "var(--accent)";
  const L = (a,b,c=fg,w=6) => a && b ? `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>` : "";
  let out = "", back = "";
  if (!P.noFloor) out += `<line x1="4" y1="110" x2="116" y2="110" stroke="var(--line)" stroke-width="2"/>`;
  for (const pr of P.props){
    if (pr.t === "bench") out += `<rect x="${pr.x1}" y="${pr.y}" width="${pr.x2-pr.x1}" height="5" rx="2" fill="${mu}"/><rect x="${pr.x1+4}" y="${pr.y+5}" width="3" height="${110-pr.y-5}" fill="${mu}"/><rect x="${pr.x2-7}" y="${pr.y+5}" width="3" height="${110-pr.y-5}" fill="${mu}"/>`;
    if (pr.t === "seat") out += `<rect x="${pr.x1}" y="${pr.y}" width="${pr.x2-pr.x1}" height="5" rx="2" fill="${mu}"/><rect x="${(pr.x1+pr.x2)/2-2}" y="${pr.y+5}" width="4" height="${110-pr.y-5}" fill="${mu}"/>`;
    if (pr.t === "bar") out += `<line x1="${pr.x1}" y1="${pr.y}" x2="${pr.x2}" y2="${pr.y}" stroke="${mu}" stroke-width="4" stroke-linecap="round"/>`;
    if (pr.t === "step") out += `<rect x="52" y="104" width="22" height="6" fill="${mu}"/>`;
  }
  const front = P.front, mir = p => p && [120 - p[0], p[1]];
  if (front){
    const sC = [60, j.S[1]], hC = [60, j.H[1]];
    back += L(mir(j.S), mir(j.E)) + L(mir(j.E), mir(j.W)) + L(mir(j.H), mir(j.K)) + L(mir(j.K), mir(j.F));
    out += back + L(j.S, mir(j.S)) + L(j.H, mir(j.H)) + L(sC, hC) + L(j.S, j.E) + L(j.E, j.W) + L(j.H, j.K) + L(j.K, j.F);
    out += `<circle cx="60" cy="${(j.S[1]-13).toFixed(1)}" r="8" fill="${fg}"/>`;
  } else {
    out += L(j.H, j.K2, mu) + L(j.K2, j.F2, mu) + L(j.S, j.E2, mu) + L(j.E2, j.W2, mu);
    out += L(j.S, j.H, fg, 6) + L(j.H, j.K) + L(j.K, j.F) + L(j.F, j.T, fg, 4) + L(j.S, j.E) + L(j.E, j.W);
    const dx = j.S[0]-j.H[0], dy = j.S[1]-j.H[1], d = Math.hypot(dx,dy) || 1;
    out += `<circle cx="${(j.S[0]+dx/d*12).toFixed(1)}" cy="${(j.S[1]+dy/d*12).toFixed(1)}" r="8" fill="${fg}"/>`;
  }
  const W = j.W, W2 = front ? mir(j.W) : null;
  for (const pr of P.props){
    const at = [W, W2].filter(Boolean);
    if (pr.t === "plate") out += at.map(w => `<circle cx="${w[0].toFixed(1)}" cy="${w[1].toFixed(1)}" r="7" fill="${ac}"/>`).join("");
    if (pr.t === "db") out += at.map(w => `<rect x="${(w[0]-6).toFixed(1)}" y="${(w[1]-3.5).toFixed(1)}" width="12" height="7" rx="2.5" fill="${ac}"/>`).join("");
    if (pr.t === "kb") out += `<circle cx="${W[0].toFixed(1)}" cy="${(W[1]+5).toFixed(1)}" r="6" fill="${ac}"/>`;
    if (pr.t === "cable") out += L(W, pr.to, mu, 1.5);
    if (pr.t === "handle") out += `<rect x="${(W[0]-2.5).toFixed(1)}" y="${(W[1]-6).toFixed(1)}" width="5" height="12" rx="2" fill="${ac}"/>`;
    if (pr.t === "lbar") out += L([W[0]-16,W[1]], [W[0]+16,W[1]], ac, 4);
    if (pr.t === "platform"){ const f = j.F; out += `<rect x="${(f[0]+3).toFixed(1)}" y="${(f[1]-16).toFixed(1)}" width="5" height="30" rx="2" fill="${ac}" transform="rotate(-30 ${(f[0]+5).toFixed(1)} ${f[1].toFixed(1)})"/>`; }
  }
  return `<svg viewBox="0 0 120 116" role="img" aria-label="${esc(opts.label || "Ilustração do exercício")}">${out}</svg>`;
}
let howRAF = null;
function openHow(name){
  const ex = LIBMAP.get(String(name).toLowerCase()) || activePlan().dias.flatMap(d => d.exercicios).find(e => e.nome === name) || { nome:name };
  const info = infoOf(ex), key = patternOf(ex), steps = HOW[key] || HOW.squat, tip = ex.dica || info.dica;
  $("#how-title").textContent = ex.nome || name;
  $("#how-meta").innerHTML = `${lvlBars(+ex.nivel || info.nivel)} <span class="note">${MUSC[info.musc] || EXTRA[info.musc] || ""}${(info.sec||[]).length ? " · também " + info.sec.map(m => MUSC[m]).join(", ") : ""}</span>`;
  $("#how-map").innerHTML = MUSC[info.musc] ? bodySVG(VIEW[info.musc], Object.assign({[info.musc]:"var(--accent)"}, ...(info.sec||[]).filter(m => VIEW[m] === VIEW[info.musc]).map(m => ({[m]:"var(--accent-soft)"}))), "Músculos trabalhados") : "";
  if (ex.foto) $("#how-map").innerHTML = `<img src="${ex.foto}" alt="Foto de ${esc(ex.nome)}" style="width:100%;max-height:220px;object-fit:contain;border-radius:10px">` + $("#how-map").innerHTML;
  const lp = LIBMAP.get(String(ex.nome||name).toLowerCase()), photo = -1, own = lp && lp.passos;
  $("#how-steps").innerHTML = (ex.custom ? [ex.dica || "Exercício criado por você."] : own ? lp.passos : steps.slice(0,3)).map(s => `<li>${esc(s)}</li>`).join("");
  $("#how-err").textContent = own ? "" : steps[3] || ""; $("#how-err").parentElement.hidden = !$("#how-err").textContent;
  $(".how-stage").classList.toggle("photo", photo >= 0);
  $("#how-tip").hidden = !tip || !!(own && lp.passos.includes(tip)); $("#how-tip").innerHTML = `<b>Dica</b>${esc(tip||"")}`;
  $("#how").hidden = false; document.body.style.overflow = "hidden";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, per = POSES[key]?.slow ? 4200 : 2600, t0 = performance.now();
  cancelAnimationFrame(howRAF);
  const frame = now => {
    const c = ((now - t0) % per) / per; let t;
    if (reduce) t = c < .5 ? 0 : 1;
    else t = c < .15 ? 0 : c < .5 ? (c-.15)/.35 : c < .65 ? 1 : 1 - (c-.65)/.35;
    const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    if (photo >= 0){ const f = t < .5 ? 0 : 1, el = $("#how-fig .spr-b");
      if (!el) $("#how-fig").innerHTML = `<span class="spr-b" role="img" aria-label="Fotos de ${esc(ex.nome||name)}" data-f="${f}" style="${sprBig(photo, f)}"></span>`;
      else if (el.dataset.f !== String(f)){ el.dataset.f = f; el.style.cssText = sprBig(photo, f); } }
    else $("#how-fig").innerHTML = figSVG(key, e, { label: "Animação: " + (ex.nome||name) });
    $("#how-phase").textContent = t < .05 ? "Posição inicial" : t > .95 ? "Posição final" : "Movimento";
    howRAF = requestAnimationFrame(frame);
  };
  howRAF = requestAnimationFrame(frame);
  $("#how-close").focus();
}
function closeHow(){ cancelAnimationFrame(howRAF); $("#how").hidden = true; document.body.style.overflow = ""; }
document.addEventListener("click", e => { const b = e.target.closest('[data-act="how"]'); if (!b) return; e.stopPropagation(); e.preventDefault(); openHow(b.dataset.n); }, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#how").hidden) closeHow(); });

/* ---------- plano rápido ---------- */
const GOALS = { hipertrofia:"Ganhar massa", emagrecimento:"Emagrecer", forca:"Força", definicao:"Definição", condicionamento:"Condicionamento", resistencia:"Resistência e cardio", mobilidade:"Mobilidade e flexibilidade", saude:"Saúde e postura", esporte:"Desempenho no esporte", funcional:"Funcional" };
const EQUIP = { academia:"Academia completa", halteres:"Halteres", barra:"Barra e anilhas", kettlebell:"Kettlebell", elastico:"Elásticos", barrafixa:"Barra fixa", banco:"Banco", cardio:"Esteira ou bike", corpo:"Só peso do corpo" };
const RX = { hipertrofia:["3-4","8-12","90s"], emagrecimento:["3","12-15","45s"], forca:["4-5","4-6","150s"], definicao:["3-4","10-15","60s"], condicionamento:["3","15-20","30s"], resistencia:["2-3","15-20","30s"], mobilidade:["2","10-12","30s"], saude:["3","10-12","60s"], esporte:["3-4","5-8","90s"], funcional:["3","10-15","45s"] };
const WARM = { mobilidade:"10 min: mobilidade de quadril, torácica e ombros + ativação de glúteos.", default:"5-8 min: cardio leve + 1-2 séries leves do primeiro exercício." };
const FINISH = { emagrecimento:"Cardio intervalado 10-15 min (30s forte / 60s leve).", condicionamento:"Circuito 8 min: burpee, polichinelo, mountain climber (40s/20s).", resistencia:"Cardio contínuo 20-30 min em ritmo moderado.", mobilidade:"Alongamento 10 min: posterior, quadril, peitoral, ombros.", saude:"Alongamento 5-10 min + respiração diafragmática.", esporte:"Pliometria 3×5 saltos + sprints curtos 6×20 m.", funcional:"Carregada do fazendeiro 3×30 m + prancha lateral 3×30s.", definicao:"Cardio moderado 15 min." };
const DEFAULT_PROFILE = { name:"", goals:["hipertrofia"], equip:["academia"], level:"iniciante", days:"3", min:"45", weight:"", height:"", age:"", sex:"", sport:"", limits:"", pref:"" };
function normProfile(p){ const o = p || {}; p = {...DEFAULT_PROFILE, ...o};
  if (!Array.isArray(o.goals) || !o.goals.length) p.goals = [o.goal || "hipertrofia"];
  if (!Array.isArray(o.equip) || !o.equip.length) p.equip = [o.place || "academia"];
  return p; }
function hasEquip(e, equip){ return !e || e === "corpo" || equip.includes("academia") || equip.includes(e) || (e === "banco" && equip.includes("halteres")); }
function basicPlan(p){
  p = normProfile(p); const goal = p.goals[0], [s,r,d] = RX[goal] || RX.hipertrofia, n = +p.days || 3;
  const per = (+p.min || 45) <= 30 ? 4 : (+p.min <= 60 ? 6 : 7);
  const pool = m => { const all = LIBRARY.filter(e => e.musc === m && !e.fedb && hasEquip(e.equip, p.equip) && !/encolhimento|depress[aã]o|suspens[aã]o|punho/i.test(e.nome));
    const lvl = p.level === "iniciante" ? 3 : 5; return all.filter(e => e.nivel <= lvl).sort((a,b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0) || (b.equip === "corpo" ? -1 : 0) - (a.equip === "corpo" ? -1 : 0) || b.nivel - a.nivel); };
  const mk = (nome, foco, groups) => { const used = new Set();
    const ex = groups.map(([m,i]) => { const pl = pool(m).filter(e => !used.has(e.nome)); const e = pl[i % Math.max(1,pl.length)] || pl[0]; if (e) used.add(e.nome); return e; }).filter(Boolean).slice(0, per);
    return { nome, foco, exercicios: ex.map(e => ({ nome:e.nome, series:s, reps: e.musc === "abdomen" && /prancha|hollow/i.test(e.nome) ? "30-45s" : r, descanso:d, dica:e.dica, musculo:e.musc, nivel:e.nivel })) }; };
  let dias;
  if (n <= 3) dias = Array.from({length:n}, (_,k) => mk("Treino " + "ABC"[k], "Corpo inteiro", [["quadriceps",k],["peito",k],["costas",k],["posterior",k],["ombros",k],["biceps",k],["triceps",k],["abdomen",k]]));
  else if (n === 4) dias = [mk("Superior A","Peito, costas, ombros",[["peito",0],["costas",0],["ombros",0],["peito",1],["costas",1],["biceps",0],["triceps",0]]), mk("Inferior A","Quadríceps e core",[["quadriceps",0],["posterior",0],["quadriceps",1],["gluteos",0],["panturrilha",0],["abdomen",0]]), mk("Superior B","Costas, peito, braços",[["costas",2],["peito",2],["ombros",1],["costas",3],["biceps",1],["triceps",1],["peito",3]]), mk("Inferior B","Posterior e glúteos",[["posterior",1],["gluteos",1],["quadriceps",2],["gluteos",2],["panturrilha",1],["abdomen",1]])];
  else { const base = k => [mk("Empurrar","Peito, ombros, tríceps",[["peito",k],["peito",k+1],["ombros",k],["ombros",k+1],["triceps",k],["triceps",k+1]]), mk("Puxar","Costas e bíceps",[["costas",k],["costas",k+1],["costas",k+2],["biceps",k],["biceps",k+1],["abdomen",k]]), mk("Pernas","Pernas e glúteos",[["quadriceps",k],["posterior",k],["quadriceps",k+1],["gluteos",k],["panturrilha",k],["abdomen",k+1]])];
    const a = base(0), b = base(2); dias = Array.from({length:n}, (_,k) => k < 3 ? a[k] : {...b[k-3], nome: b[k-3].nome + " B"}); }
  const warm = p.goals.includes("mobilidade") ? WARM.mobilidade : WARM.default, fin = p.goals.map(g => FINISH[g]).find(Boolean) || "";
  dias.forEach(x => { x.aquecimento = warm; x.finalizacao = fin; });
  return { nome: `${GOALS[goal]} ${n}x por semana`, dias, observacoes: "Plano padrão. Aumente a carga quando completar todas as séries no topo da faixa de repetições.", fonte:"rapido" };
}

/* ---------- lógica de treino ---------- */
const activePlan = () => state.plans.find(p => p.id === state.activeId) || state.plans[0];
function nSets(series){ const m = String(series).match(/\d+/g); return Math.min(6, Math.max(1, m ? +m[m.length-1] : 3)); }
function topReps(reps){ const m = String(reps).match(/\d+/g); return m ? +m[m.length-1] : 10; }
function lastForS(name){ for (let i = state.sessions.length-1; i >= 0; i--){ const e = state.sessions[i].exercicios.find(x => x.nome === name); if (e) return [state.sessions[i], e]; } return null; }
function lastFor(name){ for (let i = state.sessions.length-1; i >= 0; i--){ const e = state.sessions[i].exercicios.find(x => x.nome === name); if (e) return e; } return null; }
function suggest(ex){
  const last = lastFor(ex.nome); if (!last) return null;
  const withKg = last.sets.filter(s => +s.kg > 0); if (!withKg.length) return null;
  const kg = Math.max(...withKg.map(s => +s.kg)), top = topReps(ex.reps);
  const hit = last.sets.length >= nSets(ex.series) && last.sets.every(s => +s.reps >= top);
  const inc = CFG.inc !== "auto" ? +CFG.inc : kg >= 30 ? 2.5 : 1;
  const ph = typeof cyclePhase === "function" ? cyclePhase() : null, f = ph ? ph.f : 1, base = hit ? kg + inc : kg;
  return { kg: f < 1 ? Math.round(base * f / 0.5) * 0.5 : +base.toFixed(1), up: hit && f >= 1, last: kg, ciclo: f < 1 ? ph.t : "" };
}
function recovery(at = Date.now()){
  const load = Object.fromEntries(MUSCLES.map(m => [m,0]));
  for (const s of state.sessions){ const h = (at - Date.parse(s.date)) / 36e5; if (h < 0 || h > 24*7) continue; const dec = Math.exp(-h/24);
    for (const e of s.exercicios){ const i = infoOf(e), n = e.sets.length; if (load[i.musc] !== undefined) load[i.musc] += n*dec; (i.sec||[]).forEach(m => { if (load[m] !== undefined) load[m] += n*.5*dec; }); } }
  const pct = {}; for (const m of MUSCLES) pct[m] = Math.round(100 * (1 - Math.min(1, load[m]/10)));
  return { pct, load };
}
function nextDayIdx(){
  const P = activePlan(); if (!P) return 0;
  const last = [...state.sessions].reverse().find(s => s.planoId === P.id); if (!last) return 0;
  const i = Number.isInteger(last.diaIdx) ? last.diaIdx : P.dias.findIndex(d => d.nome === last.dia);
  return (i + 1) % P.dias.length;
}
const dayMuscles = d => [...new Set(d.exercicios.map(e => infoOf(e).musc).filter(m => MUSC[m]))];
const avgRec = (d, pct) => { const ms = dayMuscles(d); return ms.length ? Math.round(ms.reduce((a,m) => a + pct[m], 0) / ms.length) : 100; };
const listPt = a => a.length <= 1 ? (a[0]||"") : a.slice(0,-1).join(", ") + " e " + a.at(-1);

/* ---------- componentes ---------- */
const lvlBars = n => `<span class="lvl" title="Dificuldade ${n} de 5" aria-label="Dificuldade ${n} de 5">${[1,2,3,4,5].map(i => `<i class="${i<=n?"on":""}"></i>`).join("")}</span>`;
const SPR = i => ({ s: Math.floor(i/100), c: i%10, r: Math.floor(i/10)%10 });
function sprThumb(i){ const {s,c,r} = SPR(i); return `<span class="spr-t" style="background-image:url(sprites/t_${s}.jpg);background-position:${-(c*87+14.5)}px ${-(r*58)}px" aria-hidden="true"></span>`; }
function sprBig(i, f){ const {s,c,r} = SPR(i); return `background-image:url(sprites/f${f}_${s}.jpg);background-position:${c*100/9}% ${r*100/9}%`; }
function thumb(info, ex){
  const lib = ex && LIBMAP.get(String(ex.nome).toLowerCase());
  if (ex && LIBMAP.get(String(ex.nome).toLowerCase())?.foto) return `<button class="thumb fig" data-act="how" data-n="${esc(ex.nome)}" aria-label="Como fazer ${esc(ex.nome)}"><img src="${LIBMAP.get(String(ex.nome).toLowerCase()).foto}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"></button>`;
  if (ex) return `<button class="thumb fig" data-act="how" data-n="${esc(ex.nome)}" aria-label="Como fazer ${esc(ex.nome)}">${figSVG(patternOf(ex), 1, { label: ex.nome })}</button>`;
  if (!MUSC[info.musc]) return `<div class="thumb"><span class="lbl">${esc(EXTRA[info.musc]||"")}</span></div>`;
  const f = {[info.musc]:"var(--accent)"}; (info.sec||[]).forEach(m => { if (VIEW[m] === VIEW[info.musc]) f[m] = "var(--accent-soft)"; });
  return `<div class="thumb">${bodySVG(VIEW[info.musc], f, "Trabalha " + MUSC[info.musc])}</div>`;
}
function exRow(ex, pct, opts = {}){
  const info = infoOf(ex), sg = suggest(ex), n = nSets(ex.series), tip = ex.dica || info.dica, key = opts.key || "";
  const rx = opts.lib ? `${esc(EQUIP[info.equip] || "Peso do corpo")}` : `${n} séries × ${esc(ex.reps)} reps${sg ? ` × ${String(sg.kg).replace(".", ",")} kg` : ""}${sg?.up ? ` <span class="up">↑ subiu</span>` : ""}${ex.ss ? ` <span class="up">· superset com o próximo</span>` : ""}`;
  const rec = MUSC[info.musc] ? `<span class="mn">${MUSC[info.musc]}</span>${pct ? `<span class="pct" style="color:${recColor(pct[info.musc])}">${pct[info.musc]}%</span>` : ""}` : `<span class="mn">${esc(EXTRA[info.musc]||"")}</span>`;
  const tools = opts.edit ? `<button class="mini" data-act="swap" data-k="${key}" aria-expanded="false">Trocar</button><button class="mini" data-act="up" data-k="${key}">Subir</button><button class="mini" data-act="del" data-k="${key}">Remover</button>`
    : opts.lib ? `<button class="mini" data-act="add" data-k="${key}">+ Adicionar</button>` : "";
  return `<div class="exrow">${thumb(info, ex)}<div class="mid"><div class="meta">${lvlBars(+ex.nivel || info.nivel)}<button class="mini" data-act="how" data-n="${esc(ex.nome)}">Como fazer</button>${tip ? `<button class="mini" data-act="tip" aria-expanded="false">Dica</button>` : ""}${tools}</div>
    <b>${esc(ex.nome)}</b><span class="rx">${rx}</span>${tip ? `<div class="tipbox" hidden>${esc(tip)}</div>` : ""}</div><div class="rec">${rec}</div></div>`;
}
function toggleTip(btn){ const box = btn.closest(".mid").querySelector(".tipbox"); if (!box) return; box.hidden = !box.hidden; btn.setAttribute("aria-expanded", !box.hidden); }

/* ---------- telas ---------- */
function coachTip(){
  const P = activePlan(), { pct } = recovery(), S = state.sessions;
  const d = P.dias[state.homeDay ?? nextDayIdx()];
  if (!S.length) return `Bem-vindo! Comece pelo ${d.nome}. A cada treino salvo eu acompanho a recuperação de cada músculo e sugiro a carga da próxima vez.`;
  const days = Math.floor((Date.now() - Date.parse(S.at(-1).date)) / 864e5);
  const fresh = MUSCLES.filter(m => pct[m] >= 95), tired = MUSCLES.filter(m => pct[m] < 50).sort((a,b) => pct[a]-pct[b]);
  let t = "";
  if (tired.length) t += `${listPt(tired.slice(0,2).map(m => MUSC[m]))} ainda ${tired.length > 1 ? "estão" : "está"} se recuperando (${pct[tired[0]]}%). `;
  else if (fresh.length) t += `${listPt(fresh.slice(0,3).map(m => MUSC[m]))} ${fresh.length > 1 ? "estão" : "está"} 100% para treinar hoje. `;
  const a = avgRec(d, pct);
  if (a >= 70) t += `Bom dia para o ${d.nome} (${a}% recuperado).`;
  else { const best = P.dias.map((x,i) => [i, avgRec(x,pct)]).sort((x,y) => y[1]-x[1])[0];
    t += best[1] > a + 10 ? `O ${P.dias[best[0]].nome} está mais descansado (${best[1]}%), prefira ele hoje.` : `Hoje vale um treino leve, cardio ou mobilidade.`; }
  if (days >= 4) t = `Faz ${days} dias desde o último treino. ` + t;
  return t;
}
function renderHome(){
  const P = activePlan(), { pct } = recovery(); if (!P) return;
  const nx = nextDayIdx(); if (state.homeDay == null || state.homeDay >= P.dias.length) state.homeDay = nx;
  const d = P.dias[state.homeDay];
  $("#h-plan").textContent = P.nome;
  $("#h-when").textContent = state.homeDay === nx ? "Na sequência do plano" : "Você escolheu outro dia";
  $("#h-days").innerHTML = P.dias.map((x,i) => `<button class="chip" data-day="${i}" aria-pressed="${i===state.homeDay}">${esc(x.nome)}${i===nx?" ·  próximo":""}</button>`).join("");
  $("#h-day").textContent = d.nome; $("#h-focus").textContent = d.foco || "";
  $("#h-warm").hidden = !d.aquecimento; $("#h-warm").innerHTML = `<b>Aquecimento</b>${esc(d.aquecimento)}`;
  $("#h-fin").hidden = !d.finalizacao; $("#h-fin").innerHTML = `<b>Finalização</b>${esc(d.finalizacao)}`;
  $("#h-list").innerHTML = d.exercicios.map(e => exRow(e, pct)).join("") || `<p class="note">Nenhum exercício neste dia. Adicione em Rotinas.</p>`;
}
function renderRoutines(){
  const P = activePlan(); if (!P) return;
  if (state.rDay >= P.dias.length) state.rDay = 0;
  $("#plans").innerHTML = state.plans.map(p => `<div><span><b>${esc(p.nome)}</b><br><span class="note">${p.dias.length} treinos · ${p.fonte==="ia"?"gerado pela IA":p.fonte==="rapido"?"plano rápido":p.fonte==="pronto"?"programa pronto":"exemplo"}</span></span>
    <span class="row">${p.id===P.id ? `<span class="tag ok">Ativo</span>` : `<button class="btn sm" data-plan="use" data-id="${p.id}">Ativar</button>`}${state.plans.length>1?`<button class="btn sm danger" data-plan="del" data-id="${p.id}">Excluir</button>`:""}</span></div>`).join("");
  $("#r-name").textContent = P.nome;
  $("#r-src").textContent = P.fonte === "ia" ? "Gerado pela IA" : P.fonte === "rapido" ? "Plano rápido" : P.fonte === "pronto" ? "Programa pronto" : "Exemplo";
  $("#r-src").className = "tag" + (P.fonte === "ia" ? " ok" : "");
  $("#r-days").innerHTML = P.dias.map((d,i) => `<button class="chip" data-day="${i}" aria-pressed="${i===state.rDay}">${esc(d.nome)}</button>`).join("");
  const d = P.dias[state.rDay]; $("#r-day").textContent = d.nome + (d.foco ? " · " + d.foco : "");
  const { pct } = recovery();
  $("#r-list").innerHTML = d.exercicios.map((e,i) => exRow(e, pct, { edit:true, key:i })).join("") || `<p class="note">Sem exercícios. Toque em “Adicionar exercício”.</p>`;
  $("#r-notes").textContent = P.observacoes || "";
}
let libShow = 30, libSig = "";
function renderLibrary(){
  const P = activePlan(), pf = normProfile(state.profile), q = $("#l-q").value.trim().toLowerCase(), mine = $("#l-mine").checked, m = state.libMusc;
  $("#l-musc").innerHTML = [["todos","Todos"], ...Object.entries(CATS)].map(([k,t]) => `<button class="chip" data-m="${k}" aria-pressed="${k===m}">${t}</button>`).join("");
  const cur = $("#l-day").value; $("#l-day").innerHTML = P.dias.map((d,i) => `<option value="${i}">${esc(d.nome)}</option>`).join(""); if (cur && +cur < P.dias.length) $("#l-day").value = cur;
  const list = LIBRARY.map((e,i) => [e,i]).filter(([e]) => !e.hidden && (m === "todos" || catsOf(e).includes(m)) && (!mine || hasEquip(e.equip, pf.equip)) && (!q || e.nome.toLowerCase().includes(q)));
  const { pct } = recovery();
  const sig = [m, q, mine].join("|"); if (sig !== libSig){ libSig = sig; libShow = 30; }
  $("#l-list").innerHTML = list.length ? list.slice(0, libShow).map(([e,i]) => exRow(e, pct, { lib:true, key:i })).join("") + (list.length > libShow ? `<button class="btn lib-more" id="l-more">Mostrar mais (${list.length - libShow} restantes)</button>` : "") + `<p class="note lib-credit">${list.length} exercícios. Boa parte da lista: Free Exercise DB (domínio público).</p>` : `<p class="note">Nenhum exercício encontrado. Tente outro filtro ou desmarque “Só com meu equipamento”.</p>`;
  const more = $("#l-more"); if (more) more.onclick = () => { libShow += 30; renderLibrary(); };
}
function renderRecovery(){
  const { pct, load } = recovery(), fills = {}; MUSCLES.forEach(m => fills[m] = recColor(pct[m]));
  $("#bodies").innerHTML = `<figure style="margin:0">${bodySVG("f", fills, "Frente")}<figcaption>Frente</figcaption></figure><figure style="margin:0">${bodySVG("b", fills, "Costas")}<figcaption>Costas</figcaption></figure>`;
  $("#mlist").innerHTML = MUSCLES.slice().sort((a,b) => pct[a]-pct[b]).map(m => { const h = load[m] > 1.5 ? Math.ceil(24*Math.log(load[m]/1.5)) : 0;
    return `<div class="mrow"><span>${MUSC[m]}</span><div class="bar"><span style="width:${pct[m]}%;background:${recColor(pct[m])}"></span></div><span class="p">${pct[m]}%</span>${h ? `<small>Totalmente pronto em cerca de ${h < 24 ? h + " h" : Math.round(h/24) + (Math.round(h/24) > 1 ? " dias" : " dia")}</small>` : ""}</div>`; }).join("");
}

const DOW = ["dom.","seg.","ter.","qua.","qui.","sex.","sáb."];
const MKINDS = { peso:["Peso","kg"], gordura:["Gordura corporal","%"], peito:["Peito","cm"], cintura:["Cintura","cm"], quadril:["Quadril","cm"], braco:["Braço","cm"], coxa:["Coxa","cm"], panturrilha:["Panturrilha","cm"] };
const GLOSS = [
 ["Repetição (rep)","Uma execução completa do movimento: subir e descer uma vez."],
 ["Série","Um bloco de repetições seguidas sem parar. Ex.: 3 séries de 10 = 3 blocos de 10 repetições."],
 ["Descanso","Pausa entre séries. Força pede mais (2-3 min); resistência, menos (30-60s)."],
 ["Carga","O peso que você usa no exercício, em kg."],
 ["Volume","Séries × repetições × carga. Mostra quanto trabalho total você fez."],
 ["1RM","Uma repetição máxima: o maior peso que você levanta uma única vez. O app estima pela fórmula de Epley."],
 ["Falha","Quando não dá para fazer mais nenhuma repetição com boa técnica."],
 ["RIR","Repetições na reserva: quantas você ainda conseguiria fazer. RIR 2 = parou 2 antes da falha."],
 ["RPE","Escala de esforço de 1 a 10. RPE 8 = bem difícil, sobrando umas 2 repetições."],
 ["Progressão de carga","Aumentar peso, repetições ou séries aos poucos para o corpo continuar evoluindo."],
 ["Hipertrofia","Aumento do tamanho do músculo."],
 ["Drop-set","Ao chegar na falha, reduz o peso na hora e continua a série."],
 ["Bi-set","Dois exercícios seguidos sem descanso entre eles."],
 ["Super-set","Dois exercícios de músculos opostos seguidos, como bíceps e tríceps."],
 ["Circuito","Vários exercícios em sequência com pouco descanso, comum para condicionamento."],
 ["HIIT","Treino intervalado de alta intensidade: tiros fortes alternados com descanso."],
 ["Cardio","Exercício que eleva os batimentos por mais tempo: corrida, bike, corda."],
 ["Aquecimento","Atividade leve antes do treino para preparar músculos e articulações."],
 ["Mobilidade","Capacidade de mover a articulação com amplitude e controle."],
 ["Amplitude","O tamanho do movimento. Amplitude completa = do alongado ao contraído."],
 ["Cadência","Velocidade da repetição. Ex.: 3 segundos descendo, 1 subindo."],
 ["Excêntrica","Fase em que o músculo alonga sob carga (descer no agachamento)."],
 ["Concêntrica","Fase em que o músculo encurta (subir no agachamento)."],
 ["Isometria","Segurar uma posição parada, como na prancha."],
 ["Composto","Exercício que usa várias articulações e músculos, como agachamento e supino."],
 ["Isolado","Exercício focado em um músculo, como rosca ou cadeira extensora."],
 ["Divisão (split)","Como os treinos são separados na semana: ABC, superior/inferior, corpo inteiro."],
 ["Deload","Semana mais leve, com menos carga ou volume, para o corpo se recuperar."],
 ["Platô","Fase em que o progresso trava. Pede mudança de estímulo, sono ou alimentação."],
 ["Pegada pronada / supinada / neutra","Palmas para baixo / para cima / uma de frente para a outra."],
 ["Unilateral","Exercício feito com um lado de cada vez."],
 ["Pliometria","Saltos e movimentos explosivos para potência."],
 ["Déficit calórico","Comer menos calorias do que gasta. Necessário para emagrecer."],
 ["Superávit calórico","Comer mais do que gasta. Ajuda a ganhar massa."]
];
let selDay = null, wkOffset = 0, mKind = "peso", rpRange = 30, showAllDone = false;
const startOfWeek = d => { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - x.getDay()); return x; };
const inSel = s => { const t = Date.parse(s.date); return selDay && t >= selDay.from && t < selDay.to; };
const sessVol = s => s.exercicios.reduce((b,e) => b + e.sets.reduce((c,x) => c + (+x.kg||0)*(+x.reps||0),0),0);
const sessMuscles = s => { const c = {}; s.exercicios.forEach(e => { const m = infoOf(e).musc; if (MUSC[m]) c[m] = (c[m]||0) + e.sets.length; }); return Object.keys(c).sort((a,b) => c[b]-c[a]); };
function sessDur(s){ if (s.dur) return s.dur; const sets = s.exercicios.reduce((a,e) => a + e.sets.length, 0); return Math.round(sets * 2.5 + 8); }
function sessKcal(s){ const w = parseFloat(normProfile(state.profile).weight) || 75; return Math.round(5 * w * sessDur(s) / 60); }
function weekCount(off = 0){ const a = startOfWeek(Date.now()); a.setDate(a.getDate() + off*7); const b = new Date(a); b.setDate(b.getDate()+7);
  return state.sessions.filter(s => { const t = Date.parse(s.date); return t >= a && t < b; }).length; }
function streakWeeks(){ let n = 0, off = weekCount(0) ? 0 : -1; while (weekCount(off) > 0 && n < 520){ n++; off--; } return n; }
function ringSVG(done, goal){ const r = 26, c = 2*Math.PI*r, f = Math.min(1, goal ? done/goal : 0);
  return `<svg viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${done} de ${goal} treinos"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--line)" stroke-width="6"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="${f>=1?"var(--ok)":"var(--accent)"}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c*f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="36.5" text-anchor="middle" style="font-family:var(--display);font-weight:800;font-size:15px;fill:var(--fg)">${done}/${goal}</text></svg>`; }
function weeklyCoachText(){
  const pf = normProfile(state.profile), goal = +pf.days || 3, done = weekCount(0), today = new Date().getDay(), left = 6 - today + 1;
  const P = activePlan(), nx = P?.dias[nextDayIdx()];
  if (done >= goal) return `Meta batida: ${done} de ${goal} treinos nesta semana. ${done > goal ? "Você foi além do planejado; cuide do sono e da alimentação para recuperar bem." : "Se quiser treinar de novo, prefira algo leve como cardio ou mobilidade."}`;
  const need = goal - done;
  let t = `Você está em ${done} de ${goal} treinos nesta semana. `;
  if (need > left) t += `Faltam ${need} e só restam ${left} ${left===1?"dia":"dias"}, então a meta ficou apertada. Faça o que der sem pular o descanso: ${left} ${left===1?"treino bem feito":"treinos bem feitos"} já mantém o ritmo.`;
  else if (done === 0) t += `A semana ainda não começou para você. Comece hoje com o ${nx?.nome || "próximo treino"} e distribua os ${goal} treinos nos ${left} dias que faltam.`;
  else t += `Falta${need>1?"m":""} ${need}. ${nx ? `O próximo é o ${nx.nome}.` : ""} Com ${left} ${left===1?"dia":"dias"} pela frente, dá para fechar a meta com folga.`;
  return t;
}
function renderProgress(){
  renderClub(); renderRM(); renderGoals(); renderMuscleWeek(); renderHealth(); renderXP(); $("#rt-title").textContent = `Nível e retrospectiva ${new Date().getFullYear()}`; renderLeague(); renderAch(); renderChallenges(); renderFeed(); renderCompare();
  const pf = normProfile(state.profile), S = state.sessions;
  $("#pr-name").textContent = (pf.name || "Atleta") + (pf.age ? `, ${pf.age}` : "");
  $("#pr-goal").textContent = pf.goals.map(g => GOALS[g]).join(", ");
  const lastW = (state.measures||[]).filter(m => m.tipo === "peso").sort((a,b) => a.date.localeCompare(b.date)).at(-1);
  $("#pr-weight").textContent = lastW ? `${String(lastW.valor).replace(".",",")} kg` : pf.weight ? `${pf.weight} kg` : "—";
  $("#pr-freq").textContent = `${pf.days}x por semana`;
  const goal = +pf.days || 3, done = weekCount(0);
  $("#pr-ring").innerHTML = ringSVG(done, goal);
  $("#pr-ring-s").textContent = done >= goal ? "Meta da semana batida" : goal - done === 1 ? "Mais um bate a meta" : `Faltam ${goal - done} para a meta`;
  if (!$("#pr-coach").dataset.ai) $("#pr-coach").textContent = weeklyCoachText();
  // calendário
  const a = startOfWeek(Date.now()); a.setDate(a.getDate() + wkOffset*7);
  const todayKey = new Date().toDateString();
  const cells = Array.from({length:7}, (_,i) => { const d = new Date(a); d.setDate(d.getDate()+i);
    const has = S.filter(s => new Date(s.date).toDateString() === d.toDateString());
    const isSel = selDay && selDay.kind === "d" && selDay.from === +d;
    return `<button class="day${has.length?" on":""}${d.toDateString()===todayKey?" today":""}" data-i="${i}" aria-pressed="${!!isSel}" aria-label="${d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}${has.length?": "+has.map(s=>esc(s.dia)).join(", "):""}"><span class="dw">${DOW[i]}</span><span class="dn">${d.getDate()}</span></button>`; }).join("");
  const wc = weekCount(wkOffset);
  $("#pr-week").innerHTML = cells + `<button class="day goal" data-i="w" aria-pressed="${!!(selDay && selDay.kind === "w" && selDay.from === +a)}" aria-label="Semana inteira"><span class="dw">Meta</span><span class="dn" style="color:${wc>=goal?"var(--ok)":"var(--fg)"}">${wc}/${goal}</span></button>`;
  $("#pr-sel").hidden = !selDay; $("#pr-hint").hidden = !!selDay;
  if (selDay){ const n = state.sessions.filter(inSel).length; $("#pr-sel").innerHTML = `<span>Mostrando <b>${esc(selDay.label)}</b> · ${n} ${n===1?"treino":"treinos"}</span><button class="link" id="sel-clear">Ver tudo</button>`; }
  const b = new Date(a); b.setDate(b.getDate()+6);
  $("#wk-label").textContent = wkOffset === 0 ? "Esta semana" : `${a.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})} a ${b.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}`;
  $("#wk-next").disabled = wkOffset >= 0;
  const st = streakWeeks(); $("#pr-streak").textContent = st ? `Sequência: ${st} ${st>1?"semanas":"semana"}` : "Comece sua sequência";
  // concluídos
  const base = selDay ? S.filter(inSel) : S, list = base.slice().reverse().slice(0, showAllDone || selDay ? 60 : 3);
  $("#pr-more").textContent = showAllDone ? "Ver menos" : "Ver todos"; $("#pr-more").hidden = !!selDay || S.length <= 3;
  $("#pr-done").innerHTML = list.length ? list.map(s => { const ms = sessMuscles(s), idx = S.indexOf(s);
    return `<div class="done-card"><div class="row between"><div><b>${esc(s.dia)}</b><div class="note">${new Date(s.date).toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"short",year:"numeric"})}</div></div><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-card="${idx}">Cartão</button><button class="btn sm" data-rep="${idx}">Repetir</button></div></div>
      <div class="mmaps">${ms.slice(0,5).map(m => `<figure><span>${MUSC[m]}</span>${bodySVG(VIEW[m], {[m]:"var(--accent)"}, MUSC[m])}</figure>`).join("")}</div>
      <div class="dstats"><div><b>${sessDur(s)} min</b><span>Duração${s.dur?"":" (estim.)"}</span></div><div><b>${Math.round(sessVol(s)).toLocaleString("pt-BR")} kg</b><span>Volume</span></div><div><b>${sessKcal(s)}</b><span>Kcal (estim.)</span></div></div>
      <div class="note">${s.exercicios.map(e => esc(e.nome)).join(" · ")}</div></div>`; }).join("") : `<p class="note">${selDay ? `Nenhum treino em ${esc(selDay.label)}` : "Nenhum treino concluído ainda. Toque em “Iniciar treino” no Início."}</p>`;
  renderMeasures(); renderReports();
  const names = [...new Set(S.flatMap(s => s.exercicios.filter(e => e.sets.some(x=>+x.kg)).map(e => e.nome)))];
  const sel = $("#g-ex"), cur = sel.value;
  sel.innerHTML = names.length ? names.map(n => `<option>${esc(n)}</option>`).join("") : `<option>Nenhum treino com carga ainda</option>`;
  if (names.includes(cur)) sel.value = cur;
  drawChart(names.length ? sel.value : null);
  renderGloss();
}
function renderMeasures(){
  renderMeasureSum();
  $("#m-kinds").innerHTML = Object.entries(MKINDS).map(([k,[t]]) => `<button class="chip" data-k="${k}" aria-pressed="${k===mKind}">${t}</button>`).join("");
  const [t,u] = MKINDS[mKind]; $("#m-val").placeholder = `${t} em ${u}`;
  const pts = (state.measures||[]).filter(m => m.tipo === mKind).sort((a,b) => a.date.localeCompare(b.date));
  const box = $("#m-chart");
  if (!pts.length) box.innerHTML = `<p class="note">Nenhum registro de ${t.toLowerCase()} ainda. Toque em “+ Registrar”.</p>`;
  else if (pts.length === 1) box.innerHTML = `<p class="note">Primeiro registro: ${String(pts[0].valor).replace(".",",")} ${u}. Registre de novo daqui a uma ou duas semanas para ver a linha.</p>`;
  else box.innerHTML = lineSVG(pts.map(p => ({ d:new Date(p.date+"T12:00"), v:+p.valor })), u, t);
  $("#m-list").innerHTML = pts.slice().reverse().slice(0,6).map(p => `<div><span>${String(p.valor).replace(".",",")} ${u}</span><span>${new Date(p.date+"T12:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"2-digit"})} <button class="mini" data-mdel="${esc(p.id)}">Apagar</button></span></div>`).join("");
}
function lineSVG(pts, unit, label){
  const W=400,H=180,l=50,r=10,t=14,b=26, vs = pts.map(p=>p.v), mn = Math.min(...vs), mx = Math.max(...vs), pad = Math.max(.5,(mx-mn)*.15);
  const lo = mn - pad, hi = mx + pad, t0 = +pts[0].d, t1 = +pts.at(-1).d || t0+1;
  const x = d => l + (t1===t0 ? 0 : (+d - t0)/(t1 - t0)) * (W-l-r), y = v => t + (hi - v)*(H-t-b)/(hi-lo);
  const ln = pts.map((p,i) => `${i?"L":"M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const fmt = v => (Math.round(v*10)/10).toString().replace(".",",");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:320px" role="img" aria-label="${esc(label)} ao longo do tempo">
   ${[0,1,2].map(k => { const v = lo + k*(hi-lo)/2; return `<line x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${l-6}" y="${y(v)+3}" text-anchor="end">${fmt(v)}${unit}</text>`; }).join("")}
   <path d="${ln} L${x(pts.at(-1).d)},${H-b} L${l},${H-b}Z" fill="var(--accent-soft)"/>
   <path d="${ln}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
   ${pts.map((p,i) => `<circle cx="${x(p.d)}" cy="${y(p.v)}" r="${i===pts.length-1?5:3}" fill="var(--accent)"/>`).join("")}
   <text x="${l}" y="${H-8}">${pts[0].d.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}</text>
   <text x="${W-r}" y="${H-8}" text-anchor="end">${pts.at(-1).d.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})} · ${fmt(pts.at(-1).v)} ${unit}</text></svg>`;
}
function renderReports(){
  document.querySelectorAll("#rp-range .chip").forEach(c => c.setAttribute("aria-pressed", !selDay && +c.dataset.r === rpRange));
  const from = rpRange ? Date.now() - rpRange*864e5 : 0, S = state.sessions.filter(s => selDay ? inSel(s) : Date.parse(s.date) >= from);
  $("#rp-sel").textContent = selDay ? `Séries por grupo muscular em ${selDay.label}` : "Séries por grupo muscular";
  const cnt = Object.fromEntries(MUSCLES.map(m => [m,0])); let sets = 0;
  S.forEach(s => s.exercicios.forEach(e => { const m = infoOf(e).musc; sets += e.sets.length; if (cnt[m] !== undefined) cnt[m] += e.sets.length; }));
  $("#s-week").textContent = S.length; $("#s-total").textContent = sets;
  $("#s-vol").textContent = (S.reduce((a,s) => a + sessVol(s), 0)/1000).toFixed(1).replace(".",",");
  const mx = Math.max(...Object.values(cnt));
  if (!mx){ $("#rp-bars").innerHTML = `<p class="note">Salve treinos para ver quantas séries cada músculo recebeu.</p>`; return; }
  const top = Math.max(4, Math.ceil(mx/4)*4), W = 420, H = 200, l = 28, b = 24, t = 16, bw = (W-l-10)/MUSCLES.length;
  const y = v => t + (top - v)*(H-t-b)/top;
  $("#rp-bars").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:340px" role="img" aria-label="Séries por grupo muscular">
    ${[0,.5,1].map(k => `<line x1="${l}" x2="${W-10}" y1="${y(top*k)}" y2="${y(top*k)}" stroke="var(--line)"/><text x="${l-6}" y="${y(top*k)+3}" text-anchor="end">${Math.round(top*k)}</text>`).join("")}
    ${MUSCLES.map((m,i) => { const v = cnt[m], cx = l + i*bw + bw/2; return `<rect x="${(cx-bw*.32).toFixed(1)}" y="${y(v)}" width="${(bw*.64).toFixed(1)}" height="${(H-b-y(v)).toFixed(1)}" rx="3" fill="${v===mx?"var(--accent)":"var(--mus)"}"/>${v?`<text x="${cx}" y="${y(v)-5}" text-anchor="middle" style="fill:var(--fg)">${v}</text>`:""}<text x="${cx}" y="${H-b+14}" text-anchor="middle">${MUSC[m].slice(0,6)}</text>`; }).join("")}</svg><p class="note">Abaixo de 10 séries por semana costuma ser pouco para crescer um músculo.</p>`;
}
function renderGloss(){
  const q = $("#g-q").value.trim().toLowerCase();
  const items = GLOSS.filter(([t,d]) => !q || t.toLowerCase().includes(q) || d.toLowerCase().includes(q));
  $("#g-list").innerHTML = items.length ? items.map(([t,d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("") : `<dd class="note">Nenhum termo encontrado.</dd>`;
}
let hxAll = false;
function renderHistory(name){
  const box = $("#hx-list"); if (!box) return;
  const rows = name ? state.sessions.map(s => ({ s, e: s.exercicios.find(x => x.nome === name) })).filter(r => r.e).reverse() : [];
  if (!rows.length){ box.innerHTML = `<p class="note" style="margin:0">Escolha um exercício para ver todas as vezes que você fez.</p>`; return; }
  let best = 0; const bestIdx = new Map(); rows.slice().reverse().forEach(r => { const rm = Math.max(0, ...r.e.sets.map(x => e1rm(x.kg, x.reps))); if (rm > best){ best = rm; bestIdx.set(r, true); } });
  const shown = hxAll ? rows : rows.slice(0, 8);
  box.innerHTML = `<p class="note" style="margin:0">${rows.length} ${rows.length === 1 ? "vez" : "vezes"}${rows.length > 1 ? ` · primeira em ${new Date(rows.at(-1).s.date).toLocaleDateString("pt-BR")}` : ""}</p>` + shown.map(r => { const rm = Math.max(0, ...r.e.sets.map(x => e1rm(x.kg, x.reps)));
    return `<div class="hx"><div class="row between" style="flex-wrap:nowrap;gap:8px"><b>${new Date(r.s.date).toLocaleDateString("pt-BR", { weekday:"short", day:"numeric", month:"short", year:"2-digit" })}</b><span class="note" style="margin:0">${rm ? `1RM ≈ ${Math.round(rm)} kg` : ""}${bestIdx.get(r) && rm ? " · 🏆" : ""}</span></div>
      <div class="hx-sets">${r.e.sets.map((x, i) => `<span>${i+1}ª ${x.reps}${+x.kg ? ` × ${String(x.kg).replace(".", ",")} kg` : " reps"}</span>`).join("")}</div>${r.e.nota ? `<div class="note" style="margin:0">📝 ${esc(r.e.nota)}</div>` : ""}</div>`; }).join("")
    + (rows.length > 8 ? `<button class="btn sm" id="hx-more">${hxAll ? "Ver menos" : `Ver todas (${rows.length})`}</button>` : "");
}
function drawChart(name){
  renderHistory(name);
  const box = $("#chart");
  const pts = name ? state.sessions.map(s => { const e = s.exercicios.find(x=>x.nome===name); if (!e) return null;
    const v = e.sets.filter(x=>+x.kg); if (!v.length) return null;
    return { d:new Date(s.date), kg:Math.max(...v.map(x=>+x.kg)), rm:Math.max(...v.map(x=>+x.kg*(1+(+x.reps||1)/30))) }; }).filter(Boolean) : [];
  if (pts.length < 2){ box.innerHTML = `<p class="note">${pts.length ? `Salve mais um treino com este exercício para ver a linha de evolução. Hoje: ${String(pts[0].kg).replace(".", ",")} kg.` : "O gráfico aparece depois dos seus primeiros treinos com carga."}</p>`; return; }
  const W=400,H=200,l=36,r=10,t=14,b=26, max=Math.max(...pts.map(p=>p.rm)), min=Math.min(...pts.map(p=>p.kg));
  const lo=Math.floor(min*0.9/5)*5, hi=Math.ceil(max*1.05/5)*5, x=i=>l+i*(W-l-r)/(pts.length-1), y=v=>t+(hi-v)*(H-t-b)/(hi-lo||1);
  const ticks=[0,1,2,3].map(k=>lo+k*(hi-lo)/3), line = k => pts.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:320px" role="img" aria-label="Evolução de ${esc(name)}">
    ${ticks.map(v=>`<line x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" fill="none"/><text x="${l-6}" y="${y(v)+3}" text-anchor="end">${Math.round(v)}</text>`).join("")}
    <path d="${line("kg")} L${x(pts.length-1)},${H-b} L${l},${H-b}Z" fill="var(--accent-soft)" stroke="none"/>
    <path d="${line("rm")}" fill="none" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1.5"/>
    <path d="${line("kg")}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    ${pts.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.kg)}" r="${i===pts.length-1?5:3}" fill="var(--accent)"/>`).join("")}
    <text x="${l}" y="${H-8}">${pts[0].d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</text>
    <text x="${W-r}" y="${H-8}" text-anchor="end">${pts.at(-1).d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})} · ${String(pts.at(-1).kg).replace(".", ",")} kg</text></svg>`;
}
function renderAll(){ renderHome(); renderRoutines(); renderPrograms(); renderWater(); renderToday(); renderSwapWarn(); renderCycle(); renderD30(); renderCustom(); }

/* ---------- navegação ---------- */
const PANELS = ["inicio","rotinas","exercicios","recuperacao","progresso","treino","perfil"];
let lastTab = "inicio"; document.body.classList.add("on-inicio");
function tab(name){
  if (["inicio","rotinas","exercicios","recuperacao","progresso"].includes(name)) lastTab = name;
  const navName = name === "treino" ? "inicio" : name;
  document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === navName));
  PANELS.forEach(n => $("#p-"+n).hidden = n !== name);
  document.body.classList.toggle("playing", name === "treino"); document.body.classList.toggle("on-inicio", name === "inicio");
  ({ inicio:renderHome, rotinas:renderRoutines, exercicios:renderLibrary, recuperacao:renderRecovery, progresso:renderProgress })[name]?.();
  window.scrollTo(0,0);
}
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(()=>t.hidden=true, 2800); }
async function savePlans(){ try { await store.set("planos", { lista:state.plans, ativo:state.activeId }); } catch { toast("Não consegui salvar. Confira sua conexão."); } }

document.querySelector("nav").onclick = e => { const b = e.target.closest("button"); if (b) tab(b.dataset.tab); };
$("#open-profile").onclick = () => tab("perfil");
$("#close-profile").onclick = () => tab(lastTab);
$("#h-plans").onclick = () => tab("rotinas");
$("#new-plan").onclick = () => tab("perfil");
$("#h-days").onclick = e => { const b = e.target.closest("[data-day]"); if (b){ state.homeDay = +b.dataset.day; renderHome(); renderToday(); } };
$("#h-list").onclick = e => { const b = e.target.closest('[data-act="tip"]'); if (b) toggleTip(b); };
$("#h-start").onclick = () => startWorkout(state.homeDay ?? nextDayIdx());


/* rotinas: planos e edição */
let delArm = null;
$("#plans").onclick = async e => {
  const b = e.target.closest("[data-plan]"); if (!b) return; const id = b.dataset.id;
  if (b.dataset.plan === "use"){ state.activeId = id; state.homeDay = null; state.rDay = 0; await savePlans(); renderAll(); toast("Plano ativado."); }
  else if (b.dataset.plan === "del"){
    if (delArm !== id){ delArm = id; b.textContent = "Confirmar exclusão"; setTimeout(() => { if (delArm === id){ delArm = null; renderRoutines(); } }, 4000); return; }
    delArm = null; state.plans = state.plans.filter(p => p.id !== id); if (state.activeId === id){ state.activeId = state.plans[0].id; state.homeDay = null; }
    await savePlans(); renderAll(); toast("Plano excluído.");
  }
};
$("#r-days").onclick = e => { const b = e.target.closest("[data-day]"); if (b){ state.rDay = +b.dataset.day; renderRoutines(); } };
$("#r-add").onclick = () => { tab("exercicios"); $("#l-day").value = state.rDay; };
$("#r-list").onclick = async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const P = activePlan(), d = P.dias[state.rDay], i = +b.dataset.k, act = b.dataset.act;
  if (act === "tip") return toggleTip(b);
  if (act === "swap"){
    const row = b.closest(".exrow"), open = row.querySelector(".alts"); if (open){ open.remove(); b.setAttribute("aria-expanded","false"); return; }
    const info = infoOf(d.exercicios[i]), pf = normProfile(state.profile), have = new Set(d.exercicios.map(x => x.nome));
    const alts = libVis().filter(x => x.musc === info.musc && !have.has(x.nome) && hasEquip(x.equip, pf.equip)).slice(0, 8);
    row.insertAdjacentHTML("beforeend", `<div class="alts">${alts.length ? alts.map(x => `<button class="chip" data-act="pick" data-k="${i}" data-n="${esc(x.nome)}">${esc(x.nome)}</button>`).join("") : `<span class="note">Sem alternativas para seu equipamento.</span>`}</div>`);
    b.setAttribute("aria-expanded","true"); return;
  }
  if (act === "pick"){ const x = LIBMAP.get(b.dataset.n.toLowerCase()); Object.assign(d.exercicios[i], { nome:x.nome, dica:x.dica, musculo:x.musc, nivel:x.nivel }); }
  if (act === "up" && i > 0) [d.exercicios[i-1], d.exercicios[i]] = [d.exercicios[i], d.exercicios[i-1]];
  if (act === "del") d.exercicios.splice(i, 1);
  await savePlans(); renderRoutines(); if (act === "pick") toast("Exercício trocado.");
};

/* biblioteca */
$("#l-q").oninput = renderLibrary; $("#l-mine").onchange = renderLibrary;
$("#l-musc").onclick = e => { const b = e.target.closest("[data-m]"); if (b){ state.libMusc = b.dataset.m; renderLibrary(); } };
$("#l-list").onclick = async e => {
  const b = e.target.closest("[data-act]"); if (!b) return; if (b.dataset.act === "tip") return toggleTip(b);
  const x = LIBRARY[+b.dataset.k], P = activePlan(), di = +$("#l-day").value || 0, d = P.dias[di], [s,r,rest] = RX[normProfile(state.profile).goals[0]] || RX.hipertrofia;
  if (d.exercicios.some(e => e.nome === x.nome)){ toast(`${x.nome} já está no ${d.nome}.`); return; }
  d.exercicios.push({ nome:x.nome, series:s, reps: x.musc === "cardio" ? "10 min" : x.musc === "mobilidade" ? "60s" : r, descanso:rest, dica:x.dica, musculo:x.musc, nivel:x.nivel });
  await savePlans(); renderAll(); toast(`Adicionado ao ${d.nome}.`);
};

/* treino */

/* perfil e geração de planos */
const MULTI = { goals:GOALS, equip:EQUIP }, picked = { goals:[], equip:[] };
function renderChips(k){ $("#f-"+k).innerHTML = Object.entries(MULTI[k]).map(([v,t]) => { const i = picked[k].indexOf(v);
  return `<button class="chip" data-v="${v}" aria-pressed="${i>=0}">${i===0&&k==="goals"?"★ ":""}${esc(t)}</button>`; }).join(""); }
document.querySelectorAll("[data-multi]").forEach(box => box.onclick = e => { const b = e.target.closest("[data-v]"); if (!b) return;
  const k = box.dataset.multi, a = picked[k], i = a.indexOf(b.dataset.v); i >= 0 ? a.splice(i,1) : a.push(b.dataset.v); renderChips(k); });
function fillProfile(p){ p = normProfile(p); for (const k in DEFAULT_PROFILE){ if (MULTI[k]){ picked[k] = [...p[k]]; renderChips(k); continue; } const el = $("#f-"+k); if (el) el.value = p[k] ?? DEFAULT_PROFILE[k]; } }
function readProfile(){ const p = {}; for (const k in DEFAULT_PROFILE){ if (MULTI[k]){ p[k] = picked[k].length ? [...picked[k]] : [...DEFAULT_PROFILE[k]]; continue; } const el = $("#f-"+k); p[k] = el ? el.value.trim() : ""; } return p; }

async function addPlan(plan, profile){
  plan.id = "p" + Date.now(); plan.criado = new Date().toISOString();
  state.plans = [plan, ...state.plans.filter(p => p.fonte !== "exemplo")]; state.activeId = plan.id; state.profile = profile; state.homeDay = null; state.rDay = 0;
  try { await Promise.all([savePlans(), store.set("perfil", profile)]); publishLeague(); } catch {}
  renderAll(); tab("inicio");
}
$("#save-profile").onclick = async () => { state.profile = readProfile(); try { await store.set("perfil", state.profile); toast("Perfil salvo."); publishLeague(); } catch { toast("Não consegui salvar o perfil."); } };
$("#gen-basic").onclick = async () => { const p = readProfile(); await addPlan(basicPlan(p), p); toast("Plano criado e ativado."); };
$("#gen").onclick = async () => {
  if (!sample) return;
  const p = readProfile(), btn = $("#gen"), out = $("#gen-stream");
  btn.disabled = true; btn.textContent = "Montando seu plano…"; out.hidden = false; out.textContent = "Pensando…";
  const prompt = `Você é um personal trainer e preparador físico experiente. Monte um plano semanal de treino em português do Brasil para esta pessoa:
- Objetivos (o primeiro é o principal): ${p.goals.map(g => GOALS[g]).join(", ")}
- Experiência: ${p.level}
- Equipamento disponível: ${p.equip.map(e => EQUIP[e]).join(", ")}
- Dias por semana: ${p.days}
- Minutos por treino: ${p.min}
- Sexo: ${p.sex || "não informado"} · Idade: ${p.age || "não informada"} · Peso: ${p.weight || "?"} kg · Altura: ${p.height || "?"} cm
- Esporte praticado: ${p.sport || "nenhum"}
- Lesões/limitações: ${p.limits || "nenhuma"}
- Preferências: ${p.pref || "nenhuma"}

Regras: exatamente ${p.days} dias de treino; cabe em ${p.min} minutos incluindo aquecimento e descanso; combine os objetivos de forma equilibrada; use só o equipamento disponível; evite exercícios que agravem as limitações; adapte volume à idade e experiência; para cardio ou mobilidade use reps em tempo (ex.: "20 min"); prefira nomes desta lista quando servirem: ${libVis().filter(e => !e.fedb).map(e => e.nome).join("; ")}; dica curta de execução por exercício (máx. 12 palavras).
Campo "musculo" é o músculo principal, um destes: ${[...MUSCLES, "cardio", "mobilidade"].join(", ")}. Campo "nivel" é a dificuldade técnica de 1 a 5.
Responda SOMENTE com JSON neste formato:
{"nome":"nome curto do plano","dias":[{"nome":"Treino A","foco":"grupos musculares ou tipo de sessão","aquecimento":"1 frase","exercicios":[{"nome":"...","musculo":"costas","nivel":2,"series":"3","reps":"8-12","descanso":"90s","dica":"..."}],"finalizacao":"1 frase (cardio, alongamento ou vazio)"}],"observacoes":"2 ou 3 frases sobre progressão, recuperação e alimentação básica"}`;
  try {
    const plan = await sample.json(prompt, { onText: ({text}) => { out.textContent = text; out.scrollTop = out.scrollHeight; } });
    if (!plan?.dias?.length) throw { code:"invalid_json" };
    plan.fonte = "ia"; plan.nome = String(plan.nome || "Plano da IA"); plan.observacoes = String(plan.observacoes || "");
    plan.dias = plan.dias.map(d => ({ nome:String(d.nome||"Treino"), foco:String(d.foco||""), aquecimento:String(d.aquecimento||""), finalizacao:String(d.finalizacao||""),
      exercicios:(d.exercicios||[]).map(e => ({ nome:String(e.nome), musculo:String(e.musculo||""), nivel:Math.min(5,Math.max(1,+e.nivel||2)), series:String(e.series), reps:String(e.reps), descanso:String(e.descanso||"60s"), dica:String(e.dica||"") })) }));
    out.hidden = true;
    await addPlan(plan, p); toast("Plano da IA pronto e ativado!");
  } catch (e) {
    out.textContent = e?.code === "not_granted" ? "Você não autorizou o uso da IA nesta página. O plano rápido funciona sem ela."
      : e?.code === "rate_limited" ? "Muitos pedidos seguidos. Espere um minuto e tente de novo."
      : "Não consegui montar o plano agora. Tente de novo ou use o plano rápido.";
  } finally { btn.disabled = false; btn.textContent = "Gerar plano com IA"; }
};
$("#ai-review").onclick = async () => {
  const out = $("#ai-out"), btn = $("#ai-review");
  if (!sample){ out.textContent = "A IA não está disponível aqui."; return; }
  if (!state.sessions.length){ out.textContent = "Salve pelo menos um treino para a IA ter o que analisar."; return; }
  btn.disabled = true; out.textContent = "Analisando…";
  const hist = state.sessions.slice(-15).map(s => `${s.date.slice(0,10)} ${s.dia}: ` + s.exercicios.map(e => e.nome + " " + e.sets.map(x=>`${x.kg}x${x.reps}`).join("/")).join("; ") + (s.notas?` (nota: ${s.notas})`:"")).join("\n");
  try {
    await sample(`Você é um personal trainer. Perfil: ${JSON.stringify(normProfile(state.profile))}. Plano atual: ${activePlan().nome}.
Histórico recente (data, treino, exercício carga x reps):
${hist}

Em português do Brasil, em no máximo 6 tópicos curtos com "•": diga o que está evoluindo, onde aumentar carga na próxima sessão (com números), sinais de estagnação ou excesso, e a frequência semanal. Sem introdução.`, { onText: ({text}) => { out.textContent = text; }, cache:false });
  } catch (e) { out.textContent = e?.code === "not_granted" ? "Você não autorizou o uso da IA nesta página." : "Não consegui analisar agora. Tente de novo em instantes."; }
  finally { btn.disabled = false; }
};

$("#how-close").onclick = closeHow; $("#how-back").onclick = closeHow;
/* progresso: eventos */
$("#pr-settings").onclick = () => tab("perfil");
$("#wk-prev").onclick = () => { wkOffset--; selDay = null; renderProgress(); };
$("#wk-next").onclick = () => { if (wkOffset < 0){ wkOffset++; selDay = null; renderProgress(); } };
$("#pr-week").onclick = e => { const b = e.target.closest("[data-i]"); if (!b) return;
  const a = startOfWeek(Date.now()); a.setDate(a.getDate() + wkOffset*7);
  let next;
  if (b.dataset.i === "w"){ const z = new Date(a); z.setDate(z.getDate()+7); const y = new Date(z); y.setDate(y.getDate()-1);
    next = { kind:"w", from:+a, to:+z, label:`a semana de ${a.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})} a ${y.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}` }; }
  else { const d = new Date(a); d.setDate(d.getDate() + +b.dataset.i); const z = new Date(d); z.setDate(z.getDate()+1);
    next = { kind:"d", from:+d, to:+z, label:d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"short"}) }; }
  selDay = selDay && selDay.from === next.from && selDay.kind === next.kind ? null : next; renderProgress(); };
$("#pr-sel").onclick = e => { if (e.target.closest("#sel-clear")){ selDay = null; renderProgress(); } };
$("#pr-more").onclick = () => { showAllDone = !showAllDone; renderProgress(); };
$("#pr-done").onclick = e => { const cd = e.target.closest("[data-card]"); if (cd){ openCard(state.sessions[+cd.dataset.card]); return; } const b = e.target.closest("[data-rep]"); if (!b) return; const s = state.sessions[+b.dataset.rep];
  let P = state.plans.find(p => p.id === s.planoId) || activePlan(), i = P.dias.findIndex(d => d.nome === s.dia);
  if (i < 0 && P.dias[s.diaIdx]) i = s.diaIdx; if (i < 0){ toast("Esse treino não existe mais no plano ativo."); return; }
  if (P.id !== state.activeId){ state.activeId = P.id; savePlans(); renderAll(); }
  startWorkout(i); };
$("#m-kinds").onclick = e => { const b = e.target.closest("[data-k]"); if (b){ mKind = b.dataset.k; renderMeasures(); } };
$("#m-add-toggle").onclick = () => { const f = $("#m-add"); f.hidden = !f.hidden; if (!f.hidden){ $("#m-date").value = new Date().toLocaleDateString("sv-SE"); $("#m-val").focus(); } };
$("#m-save").onclick = async () => {
  const v = parseFloat($("#m-val").value.replace(",", ".")), dt = $("#m-date").value || new Date().toLocaleDateString("sv-SE");
  if (!(v > 0)){ toast("Digite um valor válido."); return; }
  state.measures = [...(state.measures||[]), { id:"m"+Date.now(), tipo:mKind, valor:v, date:dt }];
  try { await store.set("medidas", state.measures);
    if (mKind === "peso"){ const last = state.measures.filter(m => m.tipo === "peso").sort((a,b) => a.date.localeCompare(b.date)).at(-1); state.profile = {...normProfile(state.profile), weight:String(last.valor)}; fillProfile(state.profile); await store.set("perfil", state.profile); }
    $("#m-val").value = ""; $("#m-add").hidden = true; renderProgress(); toast("Medida salva."); }
  catch { toast("Não consegui salvar a medida."); }
};
let mDelArm = null;
$("#m-list").onclick = async e => { const b = e.target.closest("[data-mdel]"); if (!b) return; const id = b.dataset.mdel;
  if (mDelArm !== id){ mDelArm = id; b.textContent = "Confirmar"; setTimeout(() => { if (mDelArm === id){ mDelArm = null; renderMeasures(); } }, 4000); return; }
  mDelArm = null; state.measures = state.measures.filter(m => m.id !== id); await store.set("medidas", state.measures); renderProgress(); };
$("#rp-range").onclick = e => { const b = e.target.closest("[data-r]"); if (b){ rpRange = +b.dataset.r; selDay = null; renderProgress(); } };
$("#g-toggle").onclick = () => { const g = $("#g-body"); g.hidden = !g.hidden; $("#g-toggle").setAttribute("aria-expanded", !g.hidden); };
$("#g-q").oninput = renderGloss;
$("#pr-coach-ai").onclick = async () => {
  const out = $("#pr-coach"), btn = $("#pr-coach-ai");
  if (!sample){ toast("A IA não está disponível aqui."); return; }
  const pf = normProfile(state.profile), { pct } = recovery();
  btn.disabled = true; out.textContent = "Escrevendo…";
  try {
    await sample(`Você é o coach de treino do usuário no app Ironmind. Escreva uma mensagem curta (até 4 frases), calorosa e prática, em português do Brasil, sobre a semana dele. Use os números reais abaixo, sem inventar.
Hoje: ${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}
Nome: ${pf.name || "não informado"} · Objetivos: ${pf.goals.map(g => GOALS[g]).join(", ")} · Meta: ${pf.days} treinos/semana
Treinos nesta semana: ${weekCount(0)} · Semana passada: ${weekCount(-1)} · Sequência: ${streakWeeks()} semanas
Próximo treino do plano: ${activePlan().dias[nextDayIdx()]?.nome}
Recuperação (%): ${MUSCLES.map(m => MUSC[m] + " " + pct[m]).join(", ")}
Últimos treinos: ${state.sessions.slice(-4).map(s => s.date.slice(0,10) + " " + s.dia).join("; ") || "nenhum"}`, { onText: ({text}) => { out.textContent = text; } });
    out.dataset.ai = "1";
  } catch (e) { out.textContent = weeklyCoachText(); toast(e?.code === "not_granted" ? "Você não autorizou o uso da IA." : "Não consegui escrever agora."); }
  finally { btn.disabled = false; }
};

/* ---------- treino em andamento ---------- */
let wk = null, wkTimer = null, plRAF = null, rest = null, audio = null;
const REST_OPTS = [30,45,60,90,120,150,180];
const soundOn = () => { try { return localStorage.getItem("forja:sound") !== "0"; } catch { return true; } };
function saveDraft(){ try { localStorage.setItem("forja:draft", JSON.stringify(wk)); } catch {} }
function clearDraft(){ try { localStorage.removeItem("forja:draft"); } catch {} }
function restSecs(t){ t = String(t||""); const m = t.match(/(\d+)(?:\s*-\s*(\d+))?\s*(min|m\b|')?/i); if (!m) return 60; const v = +(m[2]||m[1]); return /min|m\b|'/i.test(t) ? v*60 : v; }
function unlockAudio(){ try { audio = audio || new (window.AudioContext||window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch {} }
function tone(freq, dur, vol = .2, delay = 0){
  if (!soundOn() || !audio) return;
  try { const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + delay;
    o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + .05); } catch {}
}
function mkEx(e){ const sg = suggest(e);
  return { nome:e.nome, series:e.series||"3", reps:e.reps||"10", descanso: CFG.descanso !== "plano" ? CFG.descanso + "s" : (e.descanso||"60s"), dica:e.dica||infoOf(e).dica||"", musculo:e.musculo||infoOf(e).musc, nivel:e.nivel||infoOf(e).nivel, ss:!!e.ss, sugKg: sg ? sg.kg : "",
    sets: Array.from({length: Math.max(1, nSets(e.series||"3") - (CICLO.on && CICLO.reduzir !== false && cyclePhase()?.k === "mens" && nSets(e.series||"3") >= 3 ? 1 : 0))}, () => ({ reps:"", kg:"", done:false })) }; }
function startWorkout(i){
  const P = activePlan(), d = P.dias[i]; let draft = null;
  try { draft = JSON.parse(localStorage.getItem("forja:draft")); } catch {}
  if (draft && draft.planoId === P.id && draft.diaIdx === i && Date.now() - draft.start < 6*36e5){ wk = draft; toast("Continuando o treino de onde você parou."); }
  else wk = { planoId:P.id, diaIdx:i, dia:d.nome, start:Date.now(), cur:0, list:d.exercicios.map(mkEx), aquecimento:d.aquecimento||"", finalizacao:d.finalizacao||"" };
  state.workoutDay = i; rest = null; voiceCur = -1; keepAwake(true); applyFocus();
  tab("treino"); renderPlayer(); clearInterval(wkTimer); wkTimer = setInterval(tickPlayer, 200); startPlayerAnim();
}
function stopPlayer(){ cadStop(); clearInterval(wkTimer); cancelAnimationFrame(plRAF); rest = null; try { speechSynthesis.cancel(); } catch {} keepAwake(false); }
function curEx(){ return wk?.list[wk.cur]; }
function startPlayerAnim(){
  cancelAnimationFrame(plRAF); const t0 = performance.now(), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = now => { const ex = curEx(); if (!ex || $("#p-treino").hidden){ plRAF = requestAnimationFrame(frame); return; }
    const key = patternOf(ex), per = POSES[key]?.slow ? 4200 : 2600, c = ((now - t0) % per) / per;
    let t = reduce ? (c < .5 ? 0 : 1) : c < .15 ? 0 : c < .5 ? (c-.15)/.35 : c < .65 ? 1 : 1 - (c-.65)/.35;
    t = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    $("#pl-fig").innerHTML = figSVG(key, t, { label: "Animação: " + ex.nome });
    plRAF = requestAnimationFrame(frame); };
  plRAF = requestAnimationFrame(frame);
}
const fmtClock = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
function tickPlayer(){
  if (!wk) return;
  $("#pl-time").textContent = fmtClock(Math.floor((Date.now() - wk.start)/1000));
  if (!rest) return;
  const left = Math.max(0, Math.ceil((rest.end - Date.now())/1000));
  $("#pl-clock").textContent = `${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`;
  $("#pl-bar").style.width = `${Math.max(0, Math.min(100, 100 * left / rest.total))}%`;
  if (left === 10 && rest.total > 15 && !rest.beeped[10]){ rest.beeped[10] = 1; say("Faltam dez segundos."); }
  if (left <= 3 && left > 0 && !rest.beeped[left]){ rest.beeped[left] = 1; tone(660, .15, .18); say(ptInt(left), true); }
  if (left <= 0){ rest = null; $("#pl-rest").hidden = true; tone(880, .25, .25); tone(1175, .45, .25, .28); voiceCur = wk.cur; say("Vai! " + exSay(curEx()), true);
    try { if (CFG.vibrar) navigator.vibrate?.([200,100,200]); } catch {}
    const go = $("#pl-go"); go.hidden = false; clearTimeout(go._h); go._h = setTimeout(() => go.hidden = true, 1400); }
}
function startRest(sec){
  const ex = curEx(), nextSet = ex?.sets.findIndex(s => !s.done);
  rest = { end: Date.now() + sec*1000, total: sec, beeped:{} };
  $("#pl-next").textContent = nextSet >= 0 ? `Próximo: série ${nextSet+1} de ${ex.nome}` : (() => { const n = wk.list.find(e => e.sets.some(s => !s.done)); return n ? `Próximo: ${n.nome}` : ""; })();
  $("#pl-rest").hidden = false; $("#pl-go").hidden = true; tickPlayer();
  say(`Descanse ${secSay(sec)}. ${$("#pl-next").textContent.replace("Próximo:", "Depois,").replace(/\d+/g, m => ptInt(+m))}`, true);
}
function renderPlayer(){
  if (!wk) return;
  const ex = curEx();
  $("#pl-thumbs").innerHTML = wk.list.map((e,i) => { const ok = e.sets.length && e.sets.every(s => s.done);
    return `<button class="pl-th${i===wk.cur?" on":""}${ok?" ok":""}${e.ss && i < wk.list.length-1?" ss":""}" data-i="${i}" aria-label="${esc(e.nome)}${ok?" (concluído)":""}">${figSVG(patternOf(e), 1, { label:e.nome })}${ok?`<span class="chk">✓</span>`:""}</button>`; }).join("")
    + `<button class="pl-th add" id="pl-add" aria-label="Adicionar exercício">+</button>`;
  const sound = soundOn(); $("#pl-sound").setAttribute("aria-pressed", sound); $("#pl-sound-waves").style.display = sound ? "" : "none";
  const vo = voiceOn(); $("#pl-voice").setAttribute("aria-pressed", vo); $("#pl-voice-waves").style.display = vo ? "" : "none"; $("#pl-voice").hidden = !("speechSynthesis" in window);
  if (!ex){ $("#pl-name").textContent = "Nenhum exercício"; $("#pl-rows").innerHTML = `<p class="note" style="padding:0 16px">Toque em Editar para adicionar exercícios.</p>`; $("#pl-main").textContent = "Adicionar exercício"; return; }
  const info = infoOf(ex), prev = lastFor(ex.nome), firstOpen = ex.sets.findIndex(s => !s.done);
  $("#pl-lvl").innerHTML = `${lvlBars(+ex.nivel || info.nivel)} <span class="note">${MUSC[info.musc] || EXTRA[info.musc] || ""} · exercício ${wk.cur+1} de ${wk.list.length}</span>${(() => { const [a,b] = ssGroup(wk.cur); return b > a ? ` <span class="tag ss-tag">Superset ${wk.cur-a+1}/${b-a+1}</span>` : ""; })()}`;
  $("#pl-name").textContent = ex.nome;
  $("#pl-rest-set").textContent = `${restSecs(ex.descanso)} s de descanso · alterar`;
  const showWarm = wk.aquecimento && !wk.list.some(e => e.sets.some(s => s.done));
  $("#pl-warm").hidden = !showWarm; $("#pl-warm").innerHTML = `<b>Aquecimento</b>${esc(wk.aquecimento)}`;
  $("#pl-tipbox").textContent = ex.dica || info.dica || "Sem dica para este exercício.";
  $("#pl-rows").innerHTML = ex.sets.map((s,i) => { const p = prev?.sets?.[i];
    return `<div class="pl-row${s.done?" fin":""}${i===firstOpen?" cur":""}" data-i="${i}" ${s.done?"":`role="button" aria-label="Registrar série ${i+1}"`}>
      <button class="n" data-undo="${i}" ${s.done?`aria-label="Desfazer série ${i+1}"`:"tabindex=\"-1\""}>${s.done?"✓":i+1}</button>
      <span class="prev">${p ? `${p.reps} reps × ${String(p.kg).replace(".", ",")} kg` : "—"}</span>
      <input data-s="${i}" data-f="reps" inputmode="numeric" value="${esc(s.reps)}" placeholder="${p?.reps || topReps(ex.reps)}" aria-label="Repetições série ${i+1}">
      <input data-s="${i}" data-f="kg" inputmode="decimal" value="${esc(s.kg)}" placeholder="${ex.sugKg || p?.kg || "kg"}" aria-label="Carga em kg série ${i+1}"></div>`; }).join("");
  { const box = $("#pl-last"), ls = lastForS(ex.nome);
    if (firstOpen < 0) box.hidden = true;
    else { box.hidden = false; const n = firstOpen + 1;
      if (!ls) box.innerHTML = `<small>Série ${n} · primeira vez</small><b>Sem registro anterior</b><span>Comece com uma carga confortável${ex.sugKg ? `, sugestão ${esc(String(ex.sugKg).replace(".", ","))} kg` : ""}.</span>`;
      else { const [ss, le] = ls, p = le.sets?.[firstOpen] || le.sets?.at(-1), d = new Date(ss.date).toLocaleDateString("pt-BR", { day:"numeric", month:"short" });
        const sug = ex.sugKg && p && String(ex.sugKg) !== String(p.kg) ? `Hoje: sugestão ${esc(String(ex.sugKg).replace(".", ","))} kg` : "Tente igualar ou passar uma repetição.";
        box.innerHTML = `<small>Série ${n} · última vez (${d})${le.sets?.[firstOpen] ? "" : " · última série"}</small><b>${p ? `${esc(p.reps)} reps × ${esc(String(p.kg || "0").replace(".", ","))} kg` : "—"}</b><span>${sug}</span>`; } } }
  const pending = wk.list.some((e,j) => j !== wk.cur && e.sets.some(s => !s.done));
  $("#pl-main").textContent = firstOpen >= 0 ? `Registrar série ${firstOpen+1} de ${ex.sets.length}` : pending ? "Próximo exercício" : "Concluir treino";
  $("#pl-delset").disabled = ex.sets.length <= 1 || ex.sets.at(-1).done;
  if (document.activeElement !== $("#pl-ex-note")) $("#pl-ex-note").value = ex.nota || "";
  const lastNote = (() => { for (let k = state.sessions.length-1; k >= 0; k--){ const e = state.sessions[k].exercicios.find(x => x.nome === ex.nome && x.nota); if (e) return [state.sessions[k].date, e.nota]; } return null; })();
  $("#pl-ex-last").textContent = lastNote ? `Nota de ${new Date(lastNote[0]).toLocaleDateString("pt-BR", { day:"numeric", month:"short" })}: ${lastNote[1]}` : "";
  voiceExChange();
}
function mainAction(){
  unlockAudio();
  const ex = curEx(); if (!ex){ openSheet("pl-edit"); return; }
  const i = ex.sets.findIndex(s => !s.done);
  if (i >= 0){ registerSet(i); return; }
  const next = wk.list.findIndex((e,j) => j > wk.cur && e.sets.some(s => !s.done));
  const any = wk.list.findIndex(e => e.sets.some(s => !s.done));
  if (next >= 0) wk.cur = next; else if (any >= 0) wk.cur = any; else { openEnd(); return; }
  saveDraft(); renderPlayer(); $("#p-treino").scrollTo({ top:0, behavior:"smooth" });
}
function ssGroup(i){ const L = wk.list; let a = i, b = i; while (a > 0 && L[a-1].ss) a--; while (b < L.length-1 && L[b].ss) b++; return [a, b]; }
function registerSet(i){
  unlockAudio(); cadStop();
  const ex = curEx(); if (!ex || !ex.sets[i] || ex.sets[i].done) return;
  {
    const s = ex.sets[i], rI = $(`#pl-rows input[data-s="${i}"][data-f="reps"]`), kI = $(`#pl-rows input[data-s="${i}"][data-f="kg"]`);
    s.reps = rI.value || rI.placeholder; s.kg = kI.value || (kI.placeholder !== "kg" ? kI.placeholder : "");
    s.done = true; const prMsg = checkPR(ex, s);
    const allDone = wk.list.every(e => e.sets.every(x => x.done)), [g0, g1] = ssGroup(wk.cur), open = j => wk.list[j]?.sets.some(x => !x.done);
    if (allDone) tone(988, .5, .25);
    else if (g1 > g0 && wk.cur < g1 && open(wk.cur + 1)){ wk.cur++; toast(`${prMsg ? prMsg + " " : ""}Superset: agora ${wk.list[wk.cur].nome}, sem descanso.`); }
    else if (g1 > g0){ let j = g0; while (j <= g1 && !open(j)) j++; const secs = restSecs(wk.list[g1].descanso || ex.descanso) + (j > g1 ? +CFG.extra || 0 : 0); if (j <= g1) wk.cur = j; if (CFG.autoRest) startRest(secs); }
    else if (CFG.autoRest) startRest(restSecs(ex.descanso) + (ex.sets.every(x => x.done) ? +CFG.extra || 0 : 0));
    saveDraft(); renderPlayer();
  }
}
function openSheet(id){ $("#"+id).hidden = false; }
function closeSheet(id){ $("#"+id).hidden = true; }
document.querySelectorAll("[data-close]").forEach(el => el.onclick = () => closeSheet(el.dataset.close));
function sessionFromWk(){
  const ex = wk.list.map(e => ({ nome:e.nome, musculo:infoOf(e).musc, ...(e.nota && e.nota.trim() ? { nota:e.nota.trim().slice(0, 300) } : {}), sets:e.sets.filter(s => s.done).map(s => ({ kg: parseFloat(String(s.kg).replace(",", ".")) || 0, reps: parseInt(s.reps) || 0 })) })).filter(e => e.sets.length);
  return { date:new Date().toISOString(), planoId:wk.planoId, diaIdx:wk.diaIdx, dia:wk.dia, exercicios:ex, notas:$("#pl-notes").value.trim(), prs: wk.prs || [], dur: Math.max(1, Math.min(300, Math.round((Date.now() - wk.start)/6e4))) };
}
function openEnd(){
  const s = sessionFromWk(), sets = s.exercicios.reduce((a,e) => a + e.sets.length, 0);
  $("#pl-sum").innerHTML = `<div><b>${s.dur} min</b><span>Duração</span></div><div><b>${sets}</b><span>Séries feitas</span></div><div><b>${Math.round(sessVol(s)).toLocaleString("pt-BR")} kg</b><span>Volume</span></div>`;
  $("#pl-fin").hidden = !wk.finalizacao; $("#pl-fin").innerHTML = `<b>Antes de ir</b>${esc(wk.finalizacao)}`;
  $("#pl-save").disabled = !sets; $("#pl-save").textContent = sets ? "Salvar treino" : "Registre ao menos uma série";
  $("#pl-discard").textContent = "Descartar treino"; openSheet("pl-end");
}
function exitPlayer(){ stopPlayer(); wk = null; ["pl-end","pl-edit","pl-coach"].forEach(closeSheet); state.homeDay = null; }
$("#pl-main").onclick = mainAction;
$("#pl-finish").onclick = openEnd;
$("#pl-exit").onclick = () => { if (wk && wk.list.some(e => e.sets.some(s => s.done))) openEnd(); else { clearDraft(); exitPlayer(); tab("inicio"); } };
$("#pl-voice").onclick = () => { const on = !voiceOn(); VOICE_MEM = on; try { localStorage.setItem("forja:voice", on ? "1" : "0"); } catch {} renderPlayer(); renderCfg(); toast(on ? "Treino por voz ligado" : "Treino por voz desligado"); if (on){ voiceCur = wk ? wk.cur : -1; say(rest ? "Voz ligada." : "Voz ligada. " + exSay(curEx()), true); } else try { speechSynthesis.cancel(); } catch {} };
$("#pl-sound").onclick = () => { const on = !soundOn(); try { localStorage.setItem("forja:sound", on ? "1" : "0"); } catch {} unlockAudio(); if (on) tone(880, .15); renderPlayer(); toast(on ? "Som ligado" : "Som desligado"); };
$("#pl-thumbs").onclick = e => { const b = e.target.closest("button"); if (!b) return; if (b.id === "pl-add"){ renderEdit(); openSheet("pl-edit"); setTimeout(() => $("#pl-q").focus(), 50); return; } wk.cur = +b.dataset.i; saveDraft(); renderPlayer(); };
$("#pl-rows").oninput = e => { const i = e.target.dataset.s; if (i == null) return; curEx().sets[+i][e.target.dataset.f] = e.target.value; saveDraft(); };
let sw = null, swJust = 0;
$("#pl-rows").addEventListener("pointerdown", e => { const row = e.target.closest(".pl-row"); if (!row || e.target.closest("input")) return; sw = { row, x:e.clientX, y:e.clientY, id:e.pointerId, on:false }; });
$("#pl-rows").addEventListener("pointermove", e => { if (!sw || e.pointerId !== sw.id) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (!sw.on){ if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)*1.5){ sw.on = true; sw.row.classList.add("drag"); try { sw.row.setPointerCapture(e.pointerId); } catch {} } else if (Math.abs(dy) > 10){ sw = null; return; } else return; }
  sw.dx = dx; sw.row.style.transform = `translateX(${dx}px)`; sw.row.classList.toggle("kill", Math.abs(dx) > 90); });
function swEnd(){ if (!sw) return; const { row, on, dx = 0 } = sw; sw = null; if (!on) return; swJust = Date.now(); row.classList.remove("drag");
  const ex = curEx(), i = +row.dataset.i;
  if (Math.abs(dx) > 90 && ex && ex.sets.length > 1){ row.style.transform = `translateX(${dx > 0 ? 120 : -120}%)`;
    setTimeout(() => { ex.sets.splice(i, 1); saveDraft(); renderPlayer(); toast(`Série ${i+1} removida.`); }, 180); }
  else { if (Math.abs(dx) > 90) toast("O exercício precisa de pelo menos uma série."); row.style.transform = ""; row.classList.remove("kill"); } }
$("#pl-rows").addEventListener("pointerup", swEnd); $("#pl-rows").addEventListener("pointercancel", swEnd);
$("#pl-rows").onclick = e => {
  if (e.target.closest("input") || Date.now() - swJust < 300) return;
  const b = e.target.closest("[data-undo]"), row = e.target.closest(".pl-row"); if (!row) return;
  const i = +row.dataset.i, s = curEx().sets[i];
  if (s.done){ if (b){ s.done = false; saveDraft(); renderPlayer(); } return; }
  registerSet(i); };
$("#pl-addset").onclick = () => { const ex = curEx(); if (!ex) return; ex.sets.push({ reps:"", kg:"", done:false }); saveDraft(); renderPlayer(); };
$("#pl-delset").onclick = () => { const ex = curEx(); if (!ex || ex.sets.length <= 1 || ex.sets.at(-1).done) return; ex.sets.pop(); saveDraft(); renderPlayer(); };
$("#pl-rest-set").onclick = () => { const ex = curEx(); if (!ex) return; const cur = restSecs(ex.descanso), i = REST_OPTS.findIndex(v => v > cur); ex.descanso = (REST_OPTS[i] ?? REST_OPTS[0]) + "s"; saveDraft(); renderPlayer(); };
$("#pl-minus").onclick = () => { if (rest){ rest.end = Math.max(Date.now() + 1000, rest.end - 15000); tickPlayer(); } };
$("#pl-plus").onclick = () => { if (rest){ rest.end += 15000; rest.total += 15; rest.beeped = {}; tickPlayer(); } };
$("#pl-ex-note").oninput = e => { const ex = curEx(); if (!ex) return; ex.nota = e.target.value; clearTimeout(e.target._t); e.target._t = setTimeout(saveDraft, 400); };
$("#pl-skip").onclick = () => { rest = null; $("#pl-rest").hidden = true; voiceCur = wk.cur; say(exSay(curEx()), true); };
$("#pl-tip").onclick = () => { const b = $("#pl-tipbox"); b.hidden = !b.hidden; $("#pl-tip").setAttribute("aria-expanded", !b.hidden); };
$("#pl-howto").onclick = () => { const ex = curEx(); if (ex) openHow(ex.nome); };
$("#pl-edit-btn").onclick = () => { renderEdit(); openSheet("pl-edit"); };
function renderEdit(){
  $("#pl-edit-list").innerHTML = wk.list.map((e,i) => `<div class="exrow" style="grid-template-columns:44px minmax(0,1fr) auto"><div class="thumb fig" style="width:44px;height:44px">${figSVG(patternOf(e),1,{label:e.nome})}</div><div class="mid"><b>${esc(e.nome)}</b><span class="rx">${e.sets.filter(s=>s.done).length}/${e.sets.length} séries</span></div><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="mini" data-ed="up" data-i="${i}" ${i?"":"disabled"} aria-label="Subir">↑</button><button class="mini" data-ed="down" data-i="${i}" ${i<wk.list.length-1?"":"disabled"} aria-label="Descer">↓</button><button class="mini" data-ed="del" data-i="${i}" aria-label="Remover">✕</button></div></div>${i < wk.list.length-1 ? `<button class="ss-link" data-ed="ss" data-i="${i}" aria-pressed="${!!e.ss}">${e.ss ? "🔗 Superset com o próximo (toque para desfazer)" : "+ Fazer superset com o próximo"}</button>` : ""}`).join("") || `<p class="note">Nenhum exercício. Adicione abaixo.</p>`;
  const q = $("#pl-q").value.trim().toLowerCase(), pf = normProfile(state.profile), have = new Set(wk.list.map(e => e.nome));
  const res = libVis().filter(e => !have.has(e.nome) && hasEquip(e.equip, pf.equip) && (!q || e.nome.toLowerCase().includes(q) || [MUSC[e.musc]||EXTRA[e.musc]||"", ...catsOf(e).map(c => CATS[c]||"")].join(" ").toLowerCase().includes(q))).slice(0, q ? 20 : 8);
  $("#pl-add-list").innerHTML = res.map(e => `<div class="exrow" style="grid-template-columns:44px minmax(0,1fr) auto"><div class="thumb fig" style="width:44px;height:44px">${figSVG(patternOf(e),1,{label:e.nome})}</div><div class="mid"><b>${esc(e.nome)}</b><span class="rx">${MUSC[e.musc]||EXTRA[e.musc]}</span></div><button class="btn sm" data-addex="${esc(e.nome)}">Adicionar</button></div>`).join("") || `<p class="note">Nada encontrado.</p>`;
}
$("#pl-q").oninput = renderEdit;
$("#pl-edit-list").onclick = e => { const b = e.target.closest("[data-ed]"); if (!b) return; const i = +b.dataset.i, L = wk.list, curName = L[wk.cur]?.nome;
  if (b.dataset.ed === "up" && i > 0) [L[i-1], L[i]] = [L[i], L[i-1]];
  if (b.dataset.ed === "down" && i < L.length-1) [L[i+1], L[i]] = [L[i], L[i+1]];
  if (b.dataset.ed === "del") L.splice(i, 1);
  if (b.dataset.ed === "ss") L[i].ss = !L[i].ss;
  if (L.length) L.at(-1).ss = false;
  const ni = L.findIndex(x => x.nome === curName); wk.cur = ni >= 0 ? ni : Math.min(wk.cur, Math.max(0, L.length-1));
  saveDraft(); renderEdit(); renderPlayer(); };
$("#pl-add-list").onclick = e => { const b = e.target.closest("[data-addex]"); if (!b) return; const x = LIBMAP.get(b.dataset.addex.toLowerCase()), [s,r,d] = RX[normProfile(state.profile).goals[0]] || RX.hipertrofia;
  wk.list.push(mkEx({ nome:x.nome, series:s, reps: x.musc === "cardio" ? "10 min" : x.musc === "mobilidade" ? "60s" : r, descanso:d, dica:x.dica, musculo:x.musc, nivel:x.nivel }));
  saveDraft(); renderEdit(); renderPlayer(); toast(`${x.nome} adicionado ao treino de hoje.`); };
$("#pl-save-plan").onclick = async () => { const P = state.plans.find(p => p.id === wk.planoId) || activePlan(), d = P.dias[wk.diaIdx]; if (!d) return;
  d.exercicios = wk.list.map(e => ({ nome:e.nome, series:String(e.sets.length), reps:e.reps, descanso:e.descanso, dica:e.dica, musculo:e.musculo, nivel:e.nivel, ...(e.ss ? { ss:true } : {}) }));
  await savePlans(); toast(`Lista salva no ${d.nome}.`); };
const COACH_Q = {
  treino:[["Qual carga usar?","Qual carga devo usar na próxima série?"],["Senti desconforto","Senti desconforto. Como ajustar ou substituir este exercício?"],["Dica de técnica","Me dê uma dica rápida de técnica para este exercício."]],
  geral:[["O que treinar hoje?","O que é melhor eu treinar hoje, considerando minha recuperação?"],["Posso treinar perna hoje?","Posso treinar perna hoje?"],["Como evoluir mais?","O que posso ajustar para evoluir mais rápido?"]] };
const TAB_NOME = { inicio:"Início", rotinas:"Rotinas", exercicios:"Exercícios", recuperacao:"Recuperação", progresso:"Progresso", perfil:"Perfil" };
let coachCtx = "geral";
function openCoach(){
  const playing = !$("#p-treino").hidden && wk && curEx();
  coachCtx = playing ? "treino" : "geral";
  $("#pl-coach-ctx").textContent = playing ? `Sobre o exercício atual: ${curEx().nome}` : "Sobre seus treinos, recuperação e plano";
  $("#pl-coach-quick").innerHTML = COACH_Q[coachCtx].map(([t, q]) => `<button class="chip" data-q="${esc(q)}">${esc(t)}</button>`).join("");
  $("#pl-coach-ans").textContent = sample ? "" : "O coach por IA não está disponível nesta visualização.";
  $("#pl-coach-q").value = ""; openSheet("pl-coach");
}
$("#coach-fab").onclick = openCoach;
$("#pl-coach-quick").onclick = e => { const b = e.target.closest("[data-q]"); if (b){ $("#pl-coach-q").value = b.dataset.q; $("#pl-coach-ask").click(); } };
$("#pl-coach-q").onkeydown = e => { if (e.key === "Enter") $("#pl-coach-ask").click(); };
$("#pl-coach-ask").onclick = async () => {
  const q = $("#pl-coach-q").value.trim(), out = $("#pl-coach-ans"), btn = $("#pl-coach-ask"), ex = coachCtx === "treino" ? curEx() : null;
  if (!q){ $("#pl-coach-q").focus(); return; } if (!sample){ out.textContent = "O coach por IA não está disponível nesta visualização."; return; }
  if (!ex){ const P = activePlan(), { pct } = recovery(), tela = TAB_NOME[lastTab] || "Início";
    const hist = state.sessions.slice(-8).map(s => `${s.date.slice(0,10)} ${s.dia}: ` + s.exercicios.map(e => e.nome + " " + e.sets.map(x=>`${x.kg}x${x.reps}`).join("/")).join("; ")).join("\n") || "nenhum treino salvo";
    btn.disabled = true; out.textContent = "Pensando…";
    try {
    await sample(`Você é o coach de treino do usuário dentro do app Ironmind. Responda em português do Brasil, direto, em no máximo 5 frases ou tópicos curtos com "•". Não invente dados.
Hoje: ${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}
Perfil: ${JSON.stringify(normProfile(state.profile))}
Plano ativo "${P.nome}": ${P.dias.map(d => d.nome + " (" + d.exercicios.map(e=>e.nome).join(", ") + ")").join(" | ")}
Recuperação muscular estimada (%): ${MUSCLES.map(m => MUSC[m] + " " + pct[m]).join(", ")}
Treinos recentes:
${hist}

Tela aberta no app: ${tela}
Pergunta: ${q}`, { onText: ({text}) => { out.textContent = text; }, cache:false });
    } catch (e) { out.textContent = e?.code === "not_granted" ? "Você não autorizou o uso da IA nesta página." : e?.code === "rate_limited" ? "Muitas perguntas seguidas. Espere um minuto." : "Não consegui responder agora. Tente de novo."; }
    finally { btn.disabled = false; }
    return; }
  const prev = lastFor(ex.nome);
  btn.disabled = true; out.textContent = "Pensando…";
  try { await sample(`Você é o coach de treino do usuário no app Ironmind, ao lado dele durante o treino. Responda em português do Brasil em no máximo 4 frases curtas e práticas. Não invente dados.
Perfil: ${JSON.stringify(normProfile(state.profile))}
Exercício atual: ${ex.nome} (${ex.sets.length} séries de ${ex.reps}, descanso ${ex.descanso})
Séries feitas hoje: ${ex.sets.filter(s=>s.done).map(s => `${s.reps}x${s.kg}kg`).join(", ") || "nenhuma"}
Última vez: ${prev ? prev.sets.map(s => `${s.reps}x${s.kg}kg`).join(", ") : "nunca fez"}
Carga sugerida pelo app: ${ex.sugKg || "sem histórico"}
Pergunta: ${q}`, { onText: ({text}) => { out.textContent = text; }, cache:false }); }
  catch (e) { out.textContent = e?.code === "not_granted" ? "Você não autorizou o uso da IA nesta página." : "Não consegui responder agora. Tente de novo."; }
  finally { btn.disabled = false; }
};
$("#pl-save").onclick = async () => {
  const s = sessionFromWk(); if (!s.exercicios.length) return;
  $("#pl-save").disabled = true;
  const achBefore = achState().earned;
  let offline = false;
  try { if (navigator.onLine === false) throw new Error("offline"); await withTimeout(store.addSession(s), 12000); }
  catch { offline = true; PENDING = [...PENDING.filter(x => x.date !== s.date), s]; savePending(); }
  const xpBefore = xpState();
  state.sessions.push(s); $("#pl-notes").value = ""; clearDraft(); exitPlayer(); const am = achNew(achBefore), xpAfter = xpState();
  setTimeout(() => toast(xpAfter.L > xpBefore.L ? `Subiu para o nível ${xpAfter.L}: ${xpAfter.title}! ⭐` : `+${(xpAfter.xp - xpBefore.xp).toLocaleString("pt-BR")} XP`), 3000);
  toast(offline ? "Sem conexão: treino guardado neste aparelho. Ele é enviado sozinho quando a internet voltar." : am || (s.prs.length ? `Treino salvo com ${s.prs.length} ${s.prs.length > 1 ? "recordes" : "recorde"}!` : "Treino salvo. Bom trabalho!"));
  prSec("resumo"); tab("progresso"); if (!offline){ publishLeague(); publishFeed(); }
};
let discardArm = false;
$("#pl-discard").onclick = () => { if (!discardArm){ discardArm = true; $("#pl-discard").textContent = "Toque de novo para descartar"; setTimeout(() => { discardArm = false; $("#pl-discard").textContent = "Descartar treino"; }, 4000); return; }
  discardArm = false; clearDraft(); exitPlayer(); tab("inicio"); toast("Treino descartado."); };

/* ---------- recordes pessoais e 1RM ---------- */
var DB = null, UID = null, USERCAP = null, DOWNLOADS = null;
const e1rm = (kg, reps) => (+kg > 0 && +reps > 0) ? +kg * (1 + Math.min(+reps, 15)/30) : 0;
function bestOf(name, before = Infinity){
  let kg = 0, rm = 0;
  for (const s of state.sessions){ if (Date.parse(s.date) >= before) continue; const e = s.exercicios.find(x => x.nome === name); if (!e) continue;
    for (const x of e.sets){ kg = Math.max(kg, +x.kg || 0); rm = Math.max(rm, e1rm(x.kg, x.reps)); } }
  return { kg, rm };
}
function checkPR(ex, set){
  const kg = parseFloat(String(set.kg).replace(",", ".")) || 0, reps = parseInt(set.reps) || 0; if (!kg) return;
  const hist = bestOf(ex.nome); if (!hist.kg) return; // sem histórico, não conta como recorde
  const today = ex.sets.filter(x => x.done && x !== set);
  const tKg = Math.max(0, ...today.map(x => parseFloat(String(x.kg).replace(",", ".")) || 0)), tRm = Math.max(0, ...today.map(x => e1rm(x.kg, x.reps)));
  wk.prs = wk.prs || [];
  if (kg > hist.kg && kg > tKg){ wk.prs = wk.prs.filter(p => !(p.nome === ex.nome && p.tipo === "carga")); wk.prs.push({ nome:ex.nome, tipo:"carga", valor:kg });
    tone(1320, .18, .22); tone(1568, .3, .22, .18); const m = `Novo recorde de carga! ${ex.nome}: ${String(kg).replace(".",",")} kg.`; toast(m); return m; }
  const rm = e1rm(kg, reps);
  if (rm > hist.rm * 1.005 && rm > tRm){ wk.prs = wk.prs.filter(p => !(p.nome === ex.nome && p.tipo === "1rm")); wk.prs.push({ nome:ex.nome, tipo:"1rm", valor:Math.round(rm*10)/10 });
    tone(1320, .18, .2); const m = `Recorde de força! ${ex.nome}: ${reps} × ${String(kg).replace(".",",")} kg (1RM ≈ ${Math.round(rm)} kg).`; toast(m); return m; }
  return "";
}
function renderRM(){
  const names = [...new Set(state.sessions.flatMap(s => s.exercicios.filter(e => e.sets.some(x => +x.kg)).map(e => e.nome)))];
  const ago = Date.now() - 30*864e5;
  const rows = names.map(n => { const all = bestOf(n), old = bestOf(n, ago);
    const pts = state.sessions.map(s => { const e = s.exercicios.find(x => x.nome === n); return e ? Math.max(0, ...e.sets.map(x => e1rm(x.kg, x.reps))) : null; }).filter(v => v);
    return { n, kg:all.kg, rm:all.rm, d: old.rm ? all.rm - old.rm : null, pts }; }).filter(r => r.rm).sort((a,b) => b.rm - a.rm);
  const prMonth = state.sessions.filter(s => Date.now() - Date.parse(s.date) < 30*864e5).reduce((a,s) => a + (s.prs?.length || 0), 0);
  $("#pr-count").textContent = `${prMonth} ${prMonth === 1 ? "recorde" : "recordes"} em 30 dias`;
  const spark = pts => { if (pts.length < 2) return ""; const mn = Math.min(...pts), mx = Math.max(...pts), w = 70, h = 22;
    const xy = pts.map((v,i) => `${(i*(w-4)/(pts.length-1)+2).toFixed(1)},${(h-3-(v-mn)*(h-6)/((mx-mn)||1)).toFixed(1)}`);
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${xy.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.8"/><circle cx="${xy.at(-1).split(",")[0]}" cy="${xy.at(-1).split(",")[1]}" r="2.5" fill="var(--accent)"/></svg>`; };
  $("#rm-list").innerHTML = rows.length ? `<div class="rm-row rm-h"><span>Exercício</span><span>Maior carga</span><span>1RM est.</span><span></span></div>` + rows.slice(0, 12).map(r => `<button class="rm-row" data-ex="${esc(r.n)}"><span class="rm-n">${esc(r.n)}</span><span>${String(r.kg).replace(".",",")} kg</span><span><b>${Math.round(r.rm)} kg</b>${r.d != null ? `<small class="${r.d >= 0 ? "up" : "down"}">${r.d >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(r.d))}</small>` : ""}</span><span>${spark(r.pts)}</span></button>`).join("")
    : `<p class="note">Salve treinos com carga para ver seus recordes e a força estimada de cada exercício.</p>`;
}

/* ---------- liga ---------- */
let lgMetric = "treinosSemana", lgUnsub = null, lgRows = [], lgJoin = null, lgSub = { exercicio:"", musculo:"peito" };
const LG_GROUPS = { peito:["Peito",["peito"]], costas:["Costas",["costas"]], ombros:["Ombros",["ombros"]], bracos:["Braços",["biceps","triceps"]], pernas:["Pernas",["quadriceps","posterior","gluteos","panturrilha"]], abdomen:["Abdômen",["abdomen"]] };
const AGE_DIV = [["sub18","Até 17 anos",0,17],["18-29","18 a 29 anos",18,29],["30-39","30 a 39 anos",30,39],["40-49","40 a 49 anos",40,49],["50-59","50 a 59 anos",50,59],["60+","60 anos ou mais",60,200]];
const divOf = age => { age = +age; if (!age) return null; const d = AGE_DIV.find(([,,a,b]) => age >= a && age <= b); return d ? d[0] : null; };
let lgDiv = "";
const groupOf = m => Object.keys(LG_GROUPS).find(g => LG_GROUPS[g][1].includes(m));
const weekKey = (d = new Date()) => startOfWeek(d).toISOString().slice(0,10);
function myEvolution(){
  const ago = Date.now() - 30*864e5, gains = [];
  for (const n of new Set(state.sessions.flatMap(s => s.exercicios.map(e => e.nome)))){ const old = bestOf(n, ago).rm, now = bestOf(n).rm; if (old > 0 && now > 0) gains.push((now - old) / old * 100); }
  return gains.length ? Math.round(gains.reduce((a,b) => a+b) / gains.length * 10) / 10 : 0;
}
function myLeagueStats(){
  const wkStart = startOfWeek(Date.now()), month = new Date(); month.setDate(1); month.setHours(0,0,0,0);
  const thisWeek = state.sessions.filter(s => Date.parse(s.date) >= +wkStart), thisMonth = state.sessions.filter(s => Date.parse(s.date) >= +month);
  return { semana: weekKey(), mes: month.toISOString().slice(0,7), treinosSemana: thisWeek.length, volumeSemana: Math.round(thisWeek.reduce((a,s) => a + sessVol(s), 0)),
    forca: Object.fromEntries([...new Set(state.sessions.flatMap(s => s.exercicios.map(e => e.nome)))].map(n => [n, Math.round(bestOf(n).rm)]).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0, 40)),
    musculos: thisWeek.reduce((acc,s) => { for (const e of s.exercicios){ const g = groupOf(e.musculo || infoOf(e).musc); if (g) acc[g] = Math.round((acc[g]||0) + e.sets.reduce((c,x) => c + (+x.kg||0)*(+x.reps||0), 0)); } return acc; }, {}),
    desafios: myChValues(), evolucao: myEvolution(), clube: CLUB_SEL !== undefined ? CLUB_SEL : (lgRows.find(r => r.id === UID)?.clube || null), nivel: xpState().L, xp: xpState().xp, divisao: divOf(normProfile(state.profile).age),
    sequencia: streakWeeks(), recordesMes: thisMonth.reduce((a,s) => a + (s.prs?.length || 0), 0), atualizado: new Date().toISOString() };
}
async function publishLeague(){
  if (!DB || !UID) return;
  if (!lgJoin) return;
  try { await DB.doc("liga/" + UID).set(myLeagueStats()); } catch (e) { $("#lg-note").textContent = "Não consegui publicar seus números na liga agora."; }
}
function lgValue(r){
  const cur = r.semana === weekKey(), curM = r.mes === new Date().toISOString().slice(0,7);
  if (lgMetric === "treinosSemana") return cur ? r.treinosSemana : 0;
  if (lgMetric === "volumeSemana") return cur ? r.volumeSemana : 0;
  if (lgMetric === "recordesMes") return curM ? r.recordesMes : 0;
  if (lgMetric === "exercicio") return (r.forca && r.forca[lgSub.exercicio]) || 0;
  if (lgMetric === "evolucao") return r.evolucao || 0;
  if (lgMetric === "xp") return r.xp || 0;
  if (lgMetric === "musculo") return cur ? ((r.musculos && r.musculos[lgSub.musculo]) || 0) : 0;
  return r.sequencia || 0;
}
async function renderLeague(){
  if (!$("#lg-list")) return;
  document.querySelectorAll("#lg-metric .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.m === lgMetric));
  $("#lg-join").checked = !!lgJoin;
  if (!DB){ $("#lg-list").innerHTML = ""; $("#lg-note").textContent = "A liga precisa da sua conta do Claude. Nesta visualização ela não está disponível."; return; }
  const sub = lgMetric === "exercicio" || lgMetric === "musculo"; $("#lg-sub-l").hidden = !sub;
  if (lgMetric === "exercicio"){
    const cnt = {}; lgRows.forEach(r => Object.keys(r.forca || {}).forEach(n => cnt[n] = (cnt[n]||0) + 1));
    const names = Object.keys(cnt).sort((a,b) => cnt[b]-cnt[a] || a.localeCompare(b));
    if (!names.includes(lgSub.exercicio)) lgSub.exercicio = names[0] || "";
    $("#lg-sub-t").textContent = "Exercício (1RM estimado)";
    $("#lg-sub").innerHTML = names.length ? names.map(n => `<option value="${esc(n)}"${n === lgSub.exercicio ? " selected" : ""}>${esc(n)} (${cnt[n]} ${cnt[n] > 1 ? "pessoas" : "pessoa"})</option>`).join("") : `<option value="">Ninguém registrou carga ainda</option>`;
  } else if (lgMetric === "musculo"){
    $("#lg-sub-t").textContent = "Grupo muscular (volume na semana)";
    $("#lg-sub").innerHTML = Object.entries(LG_GROUPS).map(([k,[t]]) => `<option value="${k}"${k === lgSub.musculo ? " selected" : ""}>${t}</option>`).join("");
  }
  const myDiv = divOf(normProfile(state.profile).age), cnt = {}; lgRows.forEach(r => { if (r.divisao) cnt[r.divisao] = (cnt[r.divisao]||0) + 1; });
  $("#lg-div").innerHTML = `<option value="">Todas as idades (${lgRows.length})</option>` + AGE_DIV.map(([k,t]) => `<option value="${k}"${k === lgDiv ? " selected" : ""}>${t} (${cnt[k] || 0})${k === myDiv ? " · a sua" : ""}</option>`).join("");
  const rows = lgRows.slice().filter(r => !lgDiv || r.divisao === lgDiv).map(r => ({ ...r, v: lgValue(r) })).filter(r => lgMetric !== "exercicio" || r.v > 0).sort((a,b) => b.v - a.v);
  let names = {}; try { names = USERCAP ? await USERCAP.profiles(rows.map(r => r.id)) : {}; } catch {}
  const fmt = v => lgMetric === "xp" ? `${v.toLocaleString("pt-BR")} XP` : lgMetric === "evolucao" ? `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}%` : lgMetric === "exercicio" ? `${v} kg` : (lgMetric === "volumeSemana" || lgMetric === "musculo") ? (v >= 1000 ? `${(v/1000).toFixed(1).replace(".",",")} t` : `${v} kg`) : lgMetric === "sequencia" ? `${v} sem.` : String(v);
  $("#lg-list").innerHTML = rows.length ? rows.map((r,i) => `<div class="lg-row${r.id === UID ? " me" : ""}"><span class="lg-pos">${i+1}º</span><span class="lg-name">${esc((names[r.id] && names[r.id].name) || "Atleta")}${r.id === UID ? " (você)" : ""}</span><span class="lg-v">${fmt(r.v)}</span></div>`).join("")
    : `<p class="note">${lgRows.length && lgDiv ? "Ninguém da liga está nessa faixa de idade ainda." : lgRows.length && sub ? "Ninguém da liga tem números nessa categoria ainda." : "Ninguém na liga ainda. Marque “Participar” para entrar."}</p>`;
  $("#lg-note").textContent = rows.length <= 1
    ? "Para competir, compartilhe este app com seus amigos pelo menu Compartilhar do claude.ai, convidando cada um pelo e-mail. Cada pessoa tem os próprios treinos privados; na liga aparecem só os números do ranking."
    : "Só aparecem os números do ranking e a faixa de idade (sem a idade exata). Treinos, cargas e medidas de cada pessoa continuam privados.";
}
function watchLeague(){
  if (!DB || lgUnsub) return;
  try { lgUnsub = DB.collection("liga").onSnapshot(q => { lgRows = q.docs.map(d => ({ id:d.id, ...d.data() })); renderCompare(); renderClub(); if (lgJoin === null){ const me = lgRows.find(r => r.id === UID); lgJoin = !!me; chJoined = new Set(Object.keys(me?.desafios || {})); if (lgJoin) publishLeague(); } renderLeague(); renderChallenges(); }, () => { $("#lg-note").textContent = "Não consegui carregar a liga agora."; }); } catch {}
}

/* ---------- backup ---------- */
$("#bk-export").onclick = async () => {
  const data = { app:"ironmind", versao:1, exportado:new Date().toISOString(), perfil:state.profile, planos:{ lista:state.plans, ativo:state.activeId }, medidas:state.measures || [], config:CFG, ciclo:CICLO, meus_exercicios:CUSTOM, desafio30:D30S, agua:WATER, metas:GOALS_L, saude:HEALTH, treinos:state.sessions };
  const name = `ironmind-backup-${new Date().toISOString().slice(0,10)}.json`, txt = JSON.stringify(data, null, 1);
  if (!DOWNLOADS){ $("#bk-note").textContent = "Baixar arquivos não está disponível nesta visualização."; return; }
  try { await DOWNLOADS.save({ filename:name, data:new Blob([txt], { type:"application/json" }) }); $("#bk-note").textContent = `Backup gerado: ${state.sessions.length} treinos, ${state.plans.length} planos.`; }
  catch (e) { $("#bk-note").textContent = e?.code === "cancelled" || e?.code === "declined" ? "Download cancelado." : "Não consegui gerar o arquivo agora."; }
};
let bkPending = null;
$("#bk-file").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (d.app !== "ironmind" || !Array.isArray(d.treinos)) throw 0;
    bkPending = d; $("#bk-note").innerHTML = `Arquivo de ${new Date(d.exportado).toLocaleDateString("pt-BR")} com ${d.treinos.length} treinos e ${d.planos?.lista?.length || 0} planos. Isso substitui perfil, planos e medidas atuais e soma os treinos. <button class="btn sm primary" id="bk-confirm">Restaurar agora</button>`; }
  catch { $("#bk-note").textContent = "Esse arquivo não é um backup do Ironmind."; }
};
$("#bk-note").onclick = async e => {
  if (!e.target.closest("#bk-confirm") || !bkPending) return; const d = bkPending; bkPending = null; $("#bk-note").textContent = "Restaurando…";
  try {
    const have = new Set(state.sessions.map(s => s.date)); const add = d.treinos.filter(s => !have.has(s.date));
    for (const s of add){ await store.addSession(s); state.sessions.push(s); }
    state.sessions.sort((a,b) => a.date.localeCompare(b.date));
    if (d.perfil){ state.profile = d.perfil; fillProfile(d.perfil); await store.set("perfil", d.perfil); }
    if (d.planos?.lista?.length){ state.plans = d.planos.lista; state.activeId = d.planos.ativo || d.planos.lista[0].id; await savePlans(); }
    if (Array.isArray(d.medidas)){ state.measures = d.medidas; await store.set("medidas", d.medidas); }
    if (d.config){ CFG = { ...CFG_DEF, ...d.config }; await store.set("config", CFG); renderCfg(); }
    if (d.agua){ WATER = { meta:null, dias:{}, log:[], ...d.agua }; await store.set("agua", WATER); }
    if (Array.isArray(d.metas)){ GOALS_L = d.metas; await store.set("metas", GOALS_L); }
    if (Array.isArray(d.meus_exercicios)){ CUSTOM = d.meus_exercicios; applyCustom(); await store.set("meus_exercicios", CUSTOM); }
    if (d.desafio30 !== undefined){ D30S = d.desafio30; await store.set("desafio30", D30S); }
    if (d.ciclo){ CICLO = { ...CICLO, ...d.ciclo }; await store.set("ciclo", CICLO); }
    if (d.saude?.dias){ HEALTH = { dias:{}, ...d.saude }; await store.set("saude", HEALTH); }
    state.homeDay = null; renderAll(); publishLeague(); $("#bk-note").textContent = `Pronto: ${add.length} treinos adicionados e dados restaurados.`;
  } catch { $("#bk-note").textContent = "A restauração parou no meio. Tente de novo; treinos repetidos não são duplicados."; }
};

/* ---------- lembretes (arquivo de calendário) ---------- */
const REM_DAYS = [["SU","dom"],["MO","seg"],["TU","ter"],["WE","qua"],["TH","qui"],["FR","sex"],["SA","sáb"]];
let remPick = null;
function renderRem(){
  if (!remPick){ const n = +normProfile(state.profile).days || 3; const pre = { 2:[1,4], 3:[1,3,5], 4:[1,2,4,5], 5:[1,2,3,4,5], 6:[1,2,3,4,5,6] }[n] || [1,3,5]; remPick = new Set(pre); }
  $("#rem-days").innerHTML = REM_DAYS.map(([,t],i) => `<button class="chip" data-d="${i}" aria-pressed="${remPick.has(i)}">${t}</button>`).join("");
}
$("#rem-days").onclick = e => { const b = e.target.closest("[data-d]"); if (!b) return; const i = +b.dataset.d; remPick.has(i) ? remPick.delete(i) : remPick.add(i); renderRem(); };
$("#rem-save").onclick = async () => {
  if (!remPick.size){ toast("Escolha pelo menos um dia."); return; }
  const [hh, mm] = ($("#rem-time").value || "18:30").split(":"), start = new Date(); start.setHours(+hh, +mm, 0, 0);
  while (!remPick.has(start.getDay())) start.setDate(start.getDate() + 1);
  const p2 = n => String(n).padStart(2,"0"), loc = d => `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`;
  const end = new Date(start.getTime() + (+normProfile(state.profile).min || 45) * 6e4), now = new Date();
  const stamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth()+1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}00Z`;
  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Ironmind//Treino//PT","CALSCALE:GREGORIAN","BEGIN:VEVENT",`UID:ironmind-${Date.now()}@treino`,`DTSTAMP:${stamp}`,
    `DTSTART:${loc(start)}`,`DTEND:${loc(end)}`,`RRULE:FREQ=WEEKLY;BYDAY=${[...remPick].sort().map(i => REM_DAYS[i][0]).join(",")}`,
    "SUMMARY:Treino Ironmind","DESCRIPTION:Hora de treinar! Abra o Ironmind e toque em Iniciar treino.","BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:Hora do treino","TRIGGER:-PT10M","END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
  if (!DOWNLOADS){ toast("Baixar arquivos não está disponível nesta visualização."); return; }
  try { await DOWNLOADS.save({ filename:"ironmind-lembretes.ics", data:new Blob([ics], { type:"text/calendar" }) }); toast("Abra o arquivo baixado para adicionar ao seu calendário."); }
  catch { toast("Download cancelado."); }
};

$("#g-ex").onchange = e => { hxAll = false; drawChart(e.target.value); };
$("#hx-list").onclick = e => { if (e.target.closest("#hx-more")){ hxAll = !hxAll; renderHistory($("#g-ex").value); } };
$("#rm-list").onclick = e => { const b = e.target.closest("[data-ex]"), sel = $("#g-ex"); if (!b || ![...sel.options].some(o => o.value === b.dataset.ex)) return;
  sel.value = b.dataset.ex; drawChart(sel.value); sel.closest(".card").scrollIntoView({ behavior:"smooth", block:"start" }); };
/* ---------- conquistas ---------- */
const ACH = [
  { k:"treinos", t:"Constância", ic:"✓", tiers:[1,10,25,50,100,250], un:v => `${v} ${v>1?"treinos":"treino"}`, d:"Treinos concluídos" },
  { k:"seq", t:"Sequência", ic:"🔥", tiers:[2,4,8,12,26,52], un:v => `${v} semanas`, d:"Semanas seguidas treinando (melhor marca)" },
  { k:"meta", t:"Meta batida", ic:"🎯", tiers:[1,4,12,26,52], un:v => `${v} ${v>1?"semanas":"semana"}`, d:"Semanas em que você bateu a meta de treinos" },
  { k:"prs", t:"Recordista", ic:"🏆", tiers:[1,5,10,25,50,100], un:v => `${v} ${v>1?"recordes":"recorde"}`, d:"Recordes pessoais quebrados" },
  { k:"vol", t:"Toneladas", ic:"🏋️", tiers:[10000,50000,100000,250000,500000,1000000], un:v => `${Math.floor(v/1000).toLocaleString("pt-BR")} t`, d:"Peso total levantado (carga × repetições)" },
];
const TIER_NAMES = ["Bronze","Prata","Ouro","Platina","Diamante","Lenda"];
function achState(){
  const goal = +normProfile(state.profile).days || 3, S = state.sessions.slice().sort((a,b) => a.date.localeCompare(b.date));
  const wk = d => startOfWeek(d).getTime(), weeks = new Map(); let tr = 0, prs = 0, vol = 0, best = 0, meta = 0;
  const earned = {}, cur = {};
  for (const s of S){
    tr++; prs += s.prs?.length || 0; vol += sessVol(s);
    const w = wk(Date.parse(s.date)); weeks.set(w, (weeks.get(w)||0) + 1); if (weeks.get(w) === goal) meta++;
    let run = 1, x = new Date(w); while (true){ x.setDate(x.getDate() - 7); if (weeks.has(wk(x))) run++; else break; } best = Math.max(best, run);
    Object.assign(cur, { treinos:tr, seq:best, meta, prs, vol });
    for (const a of ACH) a.tiers.forEach((t,i) => { const id = a.k + i; if (!earned[id] && cur[a.k] >= t) earned[id] = s.date; });
  }
  for (const a of ACH) cur[a.k] = cur[a.k] || 0;
  return { earned, cur };
}
function renderAch(){
  const { earned, cur } = achState(), total = ACH.reduce((n,a) => n + a.tiers.length, 0), got = Object.keys(earned).length;
  $("#ach-count").textContent = `${got} de ${total}`;
  $("#ach-list").innerHTML = ACH.map(a => {
    const n = a.tiers.filter((t,i) => earned[a.k+i]).length, next = a.tiers[n], prevT = n ? a.tiers[n-1] : 0;
    const pct = next ? Math.max(0, Math.min(100, (cur[a.k] - prevT) / (next - prevT) * 100)) : 100;
    const pips = a.tiers.map((t,i) => `<span class="pip${earned[a.k+i] ? " on" : ""}" title="${TIER_NAMES[i]}: ${a.un(t)}${earned[a.k+i] ? " (" + new Date(earned[a.k+i]).toLocaleDateString("pt-BR") + ")" : ""}"></span>`).join("");
    return `<div class="ach${n ? " got" : ""}" title="${a.d}"><div class="ach-b t${n}" aria-hidden="true"><svg viewBox="0 0 40 44"><path d="M20 2 37 12v20L20 42 3 32V12z"/></svg><span>${a.ic}</span></div>
      <div class="ach-m"><div class="row between" style="gap:6px;flex-wrap:nowrap"><b>${a.t}${n ? ` · ${TIER_NAMES[n-1]}` : ""}</b><span class="pips" aria-label="${n} de ${a.tiers.length} níveis">${pips}</span></div>
      <div class="note" style="margin:0">${a.d}</div>
      <div class="note" style="margin:0;color:var(--fg)">${next ? `${a.k === "vol" ? Math.floor(cur[a.k]/1000).toLocaleString("pt-BR") : cur[a.k]} de ${a.un(next)} para ${TIER_NAMES[n]}` : `${a.un(cur[a.k])}. Nível máximo!`}</div>
      <div class="ach-bar"><i style="width:${pct.toFixed(0)}%"></i></div></div></div>`; }).join("");
}
function achNew(before){
  const after = achState().earned, fresh = Object.keys(after).filter(k => !before[k]);
  if (!fresh.length) return "";
  const a = ACH.find(x => fresh[fresh.length-1].startsWith(x.k)), i = +fresh[fresh.length-1].slice(a.k.length);
  setTimeout(() => { tone(1047, .15, .22); tone(1319, .15, .22, .15); tone(1568, .35, .22, .3); }, 400);
  return fresh.length > 1 ? `${fresh.length} conquistas desbloqueadas, incluindo ${a.t} ${TIER_NAMES[i]}!` : `Conquista desbloqueada: ${a.t} ${TIER_NAMES[i]} ${a.ic}`;
}

/* ---------- voz ---------- */
let VOICE_MEM = false, ptVoice = null, voiceCur = -1;
const voiceOn = () => { try { const v = localStorage.getItem("forja:voice"); return v === null ? VOICE_MEM : v === "1"; } catch { return VOICE_MEM; } };
function pickVoice(){ try { const vs = speechSynthesis.getVoices(); ptVoice = vs.find(v => /pt[-_]BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang)) || null; } catch {} }
if ("speechSynthesis" in window){ pickVoice(); try { speechSynthesis.addEventListener("voiceschanged", pickVoice); } catch {} }
function say(t, cut){
  if (!voiceOn() || !("speechSynthesis" in window)) return;
  try { if (cut) speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = "pt-BR"; if (ptVoice) u.voice = ptVoice; u.rate = 1.05; speechSynthesis.speak(u); } catch {}
}
// Números por extenso para a voz: evita que o sintetizador leia "4: 12" ou "1:30" como horário.
const PT_U = ["zero","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","catorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
const PT_D = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
const PT_C = ["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
function ptInt(n){ n = Math.round(Math.abs(n)); if (n < 20) return PT_U[n]; if (n < 100) return PT_D[Math.floor(n/10)] + (n % 10 ? " e " + PT_U[n % 10] : ""); if (n === 100) return "cem"; if (n < 1000) return PT_C[Math.floor(n/100)] + (n % 100 ? " e " + ptInt(n % 100) : ""); if (n < 1e6){ const m = Math.floor(n/1000), r = n % 1000; return (m === 1 ? "mil" : ptInt(m) + " mil") + (r ? (r < 100 || r % 100 === 0 ? " e " : " ") + ptInt(r) : ""); } return String(n); }
const ptF = n => ptInt(n).replace(/\bum$/, "uma").replace(/\bdois$/, "duas");
function numSay(v){ const t = String(v).replace(",", ".").trim(), x = parseFloat(t); if (!isFinite(x)) return String(v); const [i, d] = t.split("."); return ptInt(+i) + (d && +d ? " vírgula " + (d.length === 1 || d[0] !== "0" ? ptInt(+d) : d.split("").map(c => PT_U[+c]).join(" ")) : ""); }
const secSay = n => n >= 60 && n % 60 === 0 ? `${n === 60 ? "um minuto" : ptInt(n/60) + " minutos"}` : n > 60 ? `${Math.floor(n/60) === 1 ? "um minuto" : ptInt(Math.floor(n/60)) + " minutos"} e ${ptInt(n%60)} segundos` : `${ptInt(n)} segundos`;
function exSay(ex){
  if (!ex) return ""; const i = ex.sets.findIndex(s => !s.done); if (i < 0) return ex.nome + ". Todas as séries feitas.";
  const p = lastFor(ex.nome)?.sets?.[i], kg = ex.sugKg || p?.kg;
  return `${ex.nome}. Série ${ptInt(i+1)} de ${ptInt(ex.sets.length)}. ${ptF(parseInt(p?.reps) || topReps(ex.reps))} ${(parseInt(p?.reps) || topReps(ex.reps)) === 1 ? "repetição" : "repetições"}${kg ? `, com ${numSay(kg)} quilos` : ""}.${p && p.kg && String(p.kg) !== String(kg) ? ` Da última vez, ${ptF(parseInt(p.reps) || 0)} com ${numSay(p.kg)} quilos.` : ""}`;
}
function voiceExChange(){ if (!wk) return; if (wk.cur !== voiceCur){ voiceCur = wk.cur; if (!rest) say(exSay(curEx()), true); } }

/* ---------- desafios ---------- */
const CH_MET = {
  treinos:["Mais treinos", v => `${v} ${v === 1 ? "treino" : "treinos"}`],
  volume:["Mais volume", v => v >= 1000 ? `${(v/1000).toFixed(1).replace(".",",")} t` : `${v} kg`],
  series:["Mais séries", v => `${v} ${v === 1 ? "série" : "séries"}`],
  minutos:["Mais minutos treinando", v => `${v} min`],
  recordes:["Mais recordes", v => `${v} ${v === 1 ? "recorde" : "recordes"}`] };
let chList = [], chUnsub = null, chMine = [], chJoined = null;
const chKey = c => c.dono + ":" + c.id;
function chValue(c){
  const a = Date.parse(c.inicio), b = Date.parse(c.fim), S = state.sessions.filter(s => { const t = Date.parse(s.date); return t >= a && t < b; });
  if (c.metrica === "treinos") return S.length;
  if (c.metrica === "volume") return Math.round(S.reduce((x,s) => x + sessVol(s), 0));
  if (c.metrica === "series") return S.reduce((x,s) => x + s.exercicios.reduce((y,e) => y + e.sets.length, 0), 0);
  if (c.metrica === "minutos") return S.reduce((x,s) => x + (+s.dur || 0), 0);
  if (c.metrica === "recordes") return S.reduce((x,s) => x + (s.prs?.length || 0), 0);
  return 0;
}
function myChValues(){
  const me = lgRows.find(r => r.id === UID), out = {};
  for (const k of chJoined || []){ const c = chList.find(x => chKey(x) === k); if (c) out[k] = chValue(c); else if (me?.desafios && k in me.desafios) out[k] = me.desafios[k]; }
  return out;
}
const daysLeft = c => Math.ceil((Date.parse(c.fim) - Date.now()) / 864e5);
async function renderChallenges(){
  const box = $("#ch-list"); if (!box) return;
  $("#ch-new").hidden = !DB;
  if (!DB){ box.innerHTML = `<p class="note">Os desafios precisam da sua conta do Claude. Nesta visualização eles não estão disponíveis.</p>`; return; }
  const now = Date.now(), list = chList.filter(c => Date.parse(c.fim) > now - 7*864e5).sort((a,b) => (Date.parse(a.fim) < now) - (Date.parse(b.fim) < now) || a.fim.localeCompare(b.fim));
  if (!list.length){ box.innerHTML = `<p class="note">Nenhum desafio ativo. Crie um, por exemplo “quem faz mais treinos até o fim do mês”, e chame seus amigos da liga.</p>`; return; }
  const ids = new Set(list.map(c => c.dono)); lgRows.forEach(r => ids.add(r.id));
  let names = {}; try { names = USERCAP ? await USERCAP.profiles([...ids]) : {}; } catch {}
  const nm = id => (names[id] && names[id].name) || "Atleta";
  box.innerHTML = list.map(c => {
    const k = chKey(c), ended = Date.parse(c.fim) <= now, joined = chJoined?.has(k), M = CH_MET[c.metrica] || CH_MET.treinos;
    const rows = lgRows.filter(r => r.desafios && k in r.desafios && r.id !== UID).map(r => ({ id:r.id, v:+r.desafios[k] || 0 }));
    if (joined) rows.push({ id:UID, v:chValue(c) });
    rows.sort((a,b) => b.v - a.v);
    const left = daysLeft(c), when = ended ? "Encerrado" : left <= 1 ? "Termina hoje" : `Faltam ${left} dias`;
    const win = ended && rows.length && rows[0].v > 0 ? `<p class="ch-win">🏆 Vencedor: ${esc(nm(rows[0].id))}${rows[0].id === UID ? " (você!)" : ""} com ${M[1](rows[0].v)}</p>` : "";
    return `<div class="ch${ended ? " ended" : ""}"><div class="row between" style="flex-wrap:nowrap;gap:8px"><div style="min-width:0"><b>${esc(c.titulo)}</b><div class="note" style="margin:0">${M[0]} · ${when} · criado por ${esc(nm(c.dono))}${c.dono === UID ? " (você)" : ""}</div></div><span class="tag">${rows.length} ${rows.length === 1 ? "pessoa" : "pessoas"}</span></div>
      ${win}<div class="lg-list">${rows.length ? rows.map((r,i) => `<div class="lg-row${r.id === UID ? " me" : ""}"><span class="lg-pos">${i+1}º</span><span class="lg-name">${esc(nm(r.id))}${r.id === UID ? " (você)" : ""}</span><span class="lg-v">${M[1](r.v)}</span></div>`).join("") : `<p class="note" style="margin:0">Ninguém entrou ainda.</p>`}</div>
      <div class="row" style="gap:8px">${ended ? "" : joined ? `<button class="btn sm" data-ch="leave" data-k="${esc(k)}">Sair do desafio</button>` : `<button class="btn sm primary" data-ch="join" data-k="${esc(k)}">Participar</button>`}${c.dono === UID ? `<button class="btn sm danger" data-ch="end" data-k="${esc(k)}">${ended ? "Remover" : "Cancelar desafio"}</button>` : ""}</div></div>`; }).join("");
}
function watchChallenges(){
  if (!DB || chUnsub) return;
  try { chUnsub = DB.collection("desafios").onSnapshot(q => {
    chList = q.docs.flatMap(d => (d.data().lista || []).map(c => ({ ...c, dono:d.id })));
    chMine = (q.docs.find(d => d.id === UID)?.data().lista) || [];
    renderChallenges(); }, () => { $("#ch-list").innerHTML = `<p class="note">Não consegui carregar os desafios agora.</p>`; }); } catch {}
}
async function saveMine(){ await DB.doc("desafios/" + UID).set({ lista: chMine.filter(c => Date.parse(c.fim) > Date.now() - 30*864e5).map(({ dono, ...c }) => c) }); }
async function chJoin(k){
  chJoined = chJoined || new Set(); chJoined.add(k);
  if (!lgJoin){ lgJoin = true; toast("Você também entrou na Liga Ironmind, onde os desafios ficam."); }
  await publishLeague(); renderLeague(); renderChallenges();
}
$("#ch-new").onclick = () => { const f = $("#ch-form"); f.hidden = !f.hidden; $("#ch-new").setAttribute("aria-expanded", !f.hidden); };
$("#ch-create").onclick = async () => {
  if (!DB || !UID) return;
  const met = $("#ch-met").value, dur = $("#ch-dur").value, ini = new Date(); ini.setHours(0,0,0,0);
  const fim = dur === "mes" ? new Date(ini.getFullYear(), ini.getMonth() + 1, 1) : new Date(ini.getTime() + (+dur) * 864e5);
  const lbl = dur === "mes" ? `até o fim de ${ini.toLocaleDateString("pt-BR", { month:"long" })}` : `em ${dur} dias`;
  const c = { id: Date.now().toString(36), titulo: $("#ch-title").value.trim() || `${CH_MET[met][0]} ${lbl}`, metrica: met, inicio: ini.toISOString(), fim: fim.toISOString() };
  $("#ch-create").disabled = true;
  try { chMine = [...chMine, c]; await saveMine(); $("#ch-title").value = ""; $("#ch-form").hidden = true; $("#ch-new").setAttribute("aria-expanded", "false");
    await chJoin(UID + ":" + c.id); toast("Desafio criado. Avise seus amigos para entrarem!"); }
  catch { toast("Não consegui criar o desafio agora."); }
  finally { $("#ch-create").disabled = false; }
};
$("#ch-list").onclick = async e => {
  const b = e.target.closest("[data-ch]"); if (!b || !DB) return; const k = b.dataset.k;
  if (b.dataset.ch === "join"){ await chJoin(k); toast("Você entrou no desafio. Bons treinos!"); }
  if (b.dataset.ch === "leave"){ chJoined?.delete(k); await publishLeague(); renderChallenges(); toast("Você saiu do desafio."); }
  if (b.dataset.ch === "end"){
    if (!b.dataset.arm){ b.dataset.arm = "1"; b.textContent = "Toque de novo para confirmar"; setTimeout(() => { if (b.isConnected){ delete b.dataset.arm; renderChallenges(); } }, 4000); return; }
    const id = k.split(":").slice(1).join(":"); chMine = chMine.filter(c => c.id !== id); chJoined?.delete(k);
    try { await saveMine(); await publishLeague(); toast("Desafio removido."); } catch { toast("Não consegui remover agora."); } }
};

/* ---------- configurações de treino ---------- */
const CFG_DEF = { descanso:"plano", extra:0, inc:"auto", cad:"3-0-1", autoRest:true, vibrar:true, telaLigada:true };
let CFG = { ...CFG_DEF };
function renderCfg(){
  $("#cfg-rest").value = String(CFG.descanso); $("#cfg-extra").value = String(CFG.extra); $("#cfg-inc").value = String(CFG.inc); $("#cfg-cad").value = CFG.cad || "3-0-1";
  $("#cfg-auto").checked = CFG.autoRest; $("#cfg-vib").checked = CFG.vibrar; $("#cfg-awake").checked = CFG.telaLigada;
  $("#cfg-sound").checked = soundOn(); $("#cfg-voice").checked = voiceOn();
  $("#cfg-voice").closest("label").hidden = !("speechSynthesis" in window);
}
$("#cfg-card").onchange = async e => {
  const id = e.target.id;
  if (id === "cfg-sound"){ try { localStorage.setItem("forja:sound", e.target.checked ? "1" : "0"); } catch {} }
  else if (id === "cfg-voice"){ VOICE_MEM = e.target.checked; try { localStorage.setItem("forja:voice", e.target.checked ? "1" : "0"); } catch {} }
  else {
    CFG = { cad: $("#cfg-cad").value, descanso: $("#cfg-rest").value, extra: +$("#cfg-extra").value, inc: $("#cfg-inc").value, autoRest: $("#cfg-auto").checked, vibrar: $("#cfg-vib").checked, telaLigada: $("#cfg-awake").checked };
    try { await store.set("config", CFG); } catch { toast("Não consegui salvar a configuração."); return; }
  }
  toast("Configuração salva.");
};
let wakeLock = null;
async function keepAwake(on){
  try { if (on && CFG.telaLigada && navigator.wakeLock && !wakeLock && document.visibilityState === "visible"){ wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    else if (!on && wakeLock){ await wakeLock.release(); wakeLock = null; } } catch { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wk && !$("#p-treino").hidden) keepAwake(true); });

/* ---------- feed dos amigos ---------- */
let fdDocs = [], fdLikes = {}, fdOn = null, fdMyLikes = null, fdUnsub = null, fdLkUnsub = null, fdShow = 15;
const fdKey = (uid, id) => uid + "|" + id;
function feedItems(){
  const earned = achState().earned, byDate = {};
  for (const [k, dt] of Object.entries(earned)){ const a = ACH.find(x => k.startsWith(x.k) && /^\d+$/.test(k.slice(x.k.length))); if (a) (byDate[dt] = byDate[dt] || []).push(`${a.t} ${TIER_NAMES[+k.slice(a.k.length)]}`); }
  return state.sessions.slice().sort((a,b) => b.date.localeCompare(a.date)).slice(0, 20).map(s => ({
    id: s.date.replace(/\D/g, ""), date: s.date, dia: s.dia || "Treino", dur: +s.dur || 0, vol: Math.round(sessVol(s)),
    series: s.exercicios.reduce((n,e) => n + e.sets.length, 0), exs: s.exercicios.slice(0, 5).map(e => e.nome), mais: Math.max(0, s.exercicios.length - 5),
    prs: (s.prs || []).map(p => ({ nome:p.nome, tipo:p.tipo, valor:p.valor })), conq: byDate[s.date] || [] }));
}
async function publishFeed(){
  if (!DB || !UID || !fdOn) return;
  try { await DB.doc("feed/" + UID).set({ itens: feedItems(), atualizado: new Date().toISOString() }); } catch { $("#fd-note").textContent = "Não consegui publicar seus treinos no feed agora."; }
}
function agoTxt(iso){ const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); if (m < 60) return m <= 1 ? "agora" : `há ${m} min`; const h = Math.round(m/60); if (h < 24) return `há ${h} h`; const d = Math.round(h/24); return d === 1 ? "ontem" : d < 7 ? `há ${d} dias` : new Date(iso).toLocaleDateString("pt-BR", { day:"numeric", month:"short" }); }
async function renderFeed(){
  const box = $("#fd-list"); if (!box) return;
  $("#fd-share").checked = !!fdOn; $("#fd-share").disabled = !DB;
  if (!DB){ box.innerHTML = `<p class="note">O feed precisa da sua conta do Claude. Nesta visualização ele não está disponível.</p>`; return; }
  const items = fdDocs.flatMap(d => (d.itens || []).map(it => ({ ...it, uid:d.id }))).sort((a,b) => b.date.localeCompare(a.date));
  if (!items.length){ box.innerHTML = `<p class="note">Ninguém compartilhou treinos ainda. Marque “Mostrar meus treinos” e chame seus amigos da liga para fazerem o mesmo.</p>`; return; }
  const shown = items.slice(0, fdShow), ids = new Set(shown.map(i => i.uid)); shown.forEach(i => (fdLikes[fdKey(i.uid, i.id)] || []).forEach(u => ids.add(u)));
  let names = {}; try { names = USERCAP ? await USERCAP.profiles([...ids]) : {}; } catch {}
  const nm = id => (names[id] && names[id].name) || "Atleta", ini = id => nm(id).trim().charAt(0).toUpperCase() || "A";
  box.innerHTML = shown.map(it => {
    const k = fdKey(it.uid, it.id), likers = fdLikes[k] || [], mine = likers.includes(UID), me = it.uid === UID;
    const vol = it.vol >= 1000 ? `${(it.vol/1000).toFixed(1).replace(".",",")} t` : `${it.vol} kg`;
    const prs = (it.prs || []).map(p => `<div class="fd-hl">🏆 Recorde ${p.tipo === "1rm" ? "de força" : "de carga"}: ${esc(p.nome)} · ${String(p.valor).replace(".",",")} kg${p.tipo === "1rm" ? " (1RM)" : ""}</div>`).join("");
    const cq = (it.conq || []).map(c => `<div class="fd-hl">🎖️ Conquista: ${esc(c)}</div>`).join("");
    const who = likers.length ? `<span class="note">${likers.slice(0, 3).map(u => esc(u === UID ? "você" : nm(u))).join(", ")}${likers.length > 3 ? ` e mais ${likers.length - 3}` : ""}</span>` : "";
    return `<div class="fd"><div class="fd-av" aria-hidden="true">${esc(ini(it.uid))}</div><div class="fd-b">
      <div><b>${esc(nm(it.uid))}${me ? " (você)" : ""}</b> <span class="note">· ${agoTxt(it.date)}</span></div>
      <div>Treinou <b>${esc(it.dia)}</b>: ${it.dur} min · ${it.series} séries · ${vol}</div>
      <div class="note" style="margin:0">${(it.exs || []).map(esc).join(", ")}${it.mais ? ` e mais ${it.mais}` : ""}</div>${prs}${cq}
      <div class="row" style="gap:8px;align-items:center"><button class="fd-like" data-k="${esc(k)}" aria-pressed="${mine}" aria-label="${mine ? "Descurtir" : "Curtir"}">${mine ? "❤️" : "🤍"} ${likers.length || ""}</button>${who}</div></div></div>`; }).join("")
    + (items.length > fdShow ? `<button class="btn sm" id="fd-more">Ver mais</button>` : "");
}
function watchFeed(){
  if (!DB) return;
  try { if (!fdUnsub) fdUnsub = DB.collection("feed").onSnapshot(q => { fdDocs = q.docs.map(d => ({ id:d.id, ...d.data() })); if (fdOn === null){ fdOn = fdDocs.some(d => d.id === UID); if (fdOn) publishFeed(); } renderFeed(); }, () => { $("#fd-note").textContent = "Não consegui carregar o feed agora."; }); } catch {}
  try { if (!fdLkUnsub) fdLkUnsub = DB.collection("curtidas").onSnapshot(q => { const m = {}; q.docs.forEach(d => (d.data().ids || []).forEach(k => (m[k] = m[k] || []).push(d.id)));
    fdLikes = m; if (fdMyLikes === null) fdMyLikes = new Set((q.docs.find(d => d.id === UID)?.data().ids) || []); renderFeed(); }, () => {}); } catch {}
}
$("#fd-share").onchange = async e => {
  if (!DB || !UID) return; fdOn = e.target.checked;
  if (fdOn){ await publishFeed(); toast("Seus treinos agora aparecem no feed dos amigos."); }
  else { try { await DB.doc("feed/" + UID).delete(); } catch {} toast("Seus treinos saíram do feed."); }
  renderFeed();
};
$("#fd-list").onclick = async e => {
  if (e.target.closest("#fd-more")){ fdShow += 15; renderFeed(); return; }
  const b = e.target.closest(".fd-like"); if (!b || !DB || !UID) return;
  const k = b.dataset.k; fdMyLikes = fdMyLikes || new Set();
  fdMyLikes.has(k) ? fdMyLikes.delete(k) : fdMyLikes.add(k);
  const valid = new Set(fdDocs.flatMap(d => (d.itens || []).map(it => fdKey(d.id, it.id))));
  const ids = [...fdMyLikes].filter(x => valid.has(x)).slice(-300);
  fdLikes[k] = fdMyLikes.has(k) ? [...new Set([...(fdLikes[k] || []), UID])] : (fdLikes[k] || []).filter(u => u !== UID); renderFeed();
  try { await DB.doc("curtidas/" + UID).set({ ids }); } catch { toast("Não consegui salvar a curtida."); }
};

/* ---------- programas prontos ---------- */
const PROGRAMS = [
  { id:"ini", nome:"Iniciante corpo inteiro", nivel:"Iniciante", freq:3, local:"Academia", desc:"Base para quem está começando: o corpo todo em cada treino, com cargas moderadas e foco na técnica.",
    dias:[["Treino A","Corpo inteiro",[["Leg press",3,"10-12","90s"],["Supino máquina",3,"10-12","90s"],["Pulley costas",3,"10-12","90s"],["Mesa flexora",3,"10-12","60s"],["Elevação lateral com halteres",2,"12-15","60s"],["Prancha abdominal",3,"30s","45s"]]],
          ["Treino B","Corpo inteiro",[["Agachamento goblet",3,"10-12","90s"],["Remada baixa",3,"10-12","90s"],["Desenvolvimento com halteres",3,"10-12","90s"],["Elevação pélvica",3,"12","60s"],["Rosca alternada",2,"12","60s"],["Tríceps corda",2,"12","60s"]]],
          ["Treino C","Corpo inteiro",[["Agachamento hack",3,"10-12","90s"],["Supino inclinado",3,"10-12","90s"],["Remada cavalinho",3,"10-12","90s"],["Mesa flexora",3,"12","60s"],["Elevação de panturrilhas sentado na máquina",3,"15","45s"],["Abdominal cruzado",3,"15","45s"]]]] },
  { id:"5x5", nome:"Força 5x5", nivel:"Intermediário", freq:3, local:"Barra e anilhas", desc:"Clássico de força: poucos exercícios básicos, 5 séries de 5. Alterne A e B e suba a carga quando completar todas as séries.",
    dias:[["Treino A","Agachamento, supino e remada",[["Agachamento livre",5,"5","180s"],["Supino reto",5,"5","180s"],["Remada curvada",5,"5","150s"]]],
          ["Treino B","Agachamento, desenvolvimento e terra",[["Agachamento livre",5,"5","180s"],["Desenvolvimento com barra",5,"5","180s"],["Levantamento terra",1,"5","180s"]]]] },
  { id:"ppl", nome:"Push, Pull, Legs (PPL)", nivel:"Intermediário", freq:6, local:"Academia", desc:"Divisão por movimento: empurrar, puxar e pernas, duas vezes por semana. Muito volume para hipertrofia.",
    dias:[["Push","Peito, ombros e tríceps",[["Supino reto",4,"6-8","150s"],["Supino inclinado",3,"8-12","90s"],["Desenvolvimento com halteres",3,"8-12","90s"],["Elevação lateral com halteres",3,"12-15","60s"],["Voador ou peck deck",3,"12-15","60s"],["Tríceps corda",3,"10-12","60s"]]],
          ["Pull","Costas e bíceps",[["Barra fixa",4,"6-10","150s"],["Remada curvada",3,"8-10","120s"],["Pull down",3,"10-12","90s"],["Face pull",3,"12-15","60s"],["Rosca direta com barra reta ou W",3,"8-12","60s"],["Rosca martelo",3,"10-12","60s"]]],
          ["Legs","Pernas e glúteos",[["Agachamento livre",4,"6-8","180s"],["Levantamento terra romeno",3,"8-10","120s"],["Leg press",3,"10-12","90s"],["Mesa flexora",3,"10-12","60s"],["Elevação de panturrilhas em pé na máquina",4,"12-15","45s"],["Abdominal na polia",3,"12-15","45s"]]],
          ["Push B","Ombros, peito e tríceps",[["Desenvolvimento com barra",4,"6-8","150s"],["Supino declinado (canadense)",3,"8-12","90s"],["Paralelas",3,"8-12","90s"],["Elevação lateral com halteres",4,"12-15","60s"],["Crucifixo",3,"12-15","60s"],["Tríceps francês",3,"10-12","60s"]]],
          ["Pull B","Costas e bíceps",[["Levantamento terra",3,"5","180s"],["Pulley costas",4,"8-12","90s"],["Remada serrote",3,"10-12","90s"],["Pullover com halteres",3,"12","60s"],["Rosca alternada",3,"10-12","60s"],["Rosca scott",3,"12","60s"]]],
          ["Legs B","Pernas e glúteos",[["Agachamento búlgaro",3,"8-10","120s"],["Elevação pélvica com barra",4,"8-12","90s"],["Agachamento hack",3,"10-12","90s"],["Mesa flexora",3,"12","60s"],["Cadeira extensora",3,"12-15","60s"],["Elevação de panturrilhas sentado na máquina",4,"15","45s"]]]] },
  { id:"ul", nome:"Superior e inferior", nivel:"Intermediário", freq:4, local:"Academia", desc:"Quatro treinos por semana alternando parte de cima e de baixo. Bom equilíbrio entre força e hipertrofia.",
    dias:[["Superior A","Peito, costas e ombros",[["Supino reto",4,"6-8","150s"],["Remada curvada",4,"6-8","150s"],["Desenvolvimento com halteres",3,"8-10","90s"],["Pulley costas",3,"10-12","90s"],["Rosca direta com barra reta ou W",2,"10-12","60s"],["Tríceps testa",2,"10-12","60s"]]],
          ["Inferior A","Quadríceps e core",[["Agachamento livre",4,"6-8","180s"],["Levantamento terra romeno",3,"8-10","120s"],["Leg press",3,"10-12","90s"],["Elevação de panturrilhas em pé na máquina",4,"12-15","45s"],["Prancha abdominal",3,"45s","45s"]]],
          ["Superior B","Costas, peito e braços",[["Barra fixa",4,"6-10","150s"],["Supino inclinado",4,"8-10","90s"],["Remada baixa",3,"10-12","90s"],["Elevação lateral com halteres",3,"12-15","60s"],["Rosca martelo",2,"10-12","60s"],["Tríceps corda",2,"10-12","60s"]]],
          ["Inferior B","Posterior e glúteos",[["Levantamento terra",3,"5","180s"],["Agachamento búlgaro",3,"8-10","120s"],["Elevação pélvica com barra",3,"10-12","90s"],["Mesa flexora",3,"10-12","60s"],["Elevação de panturrilhas sentado na máquina",3,"15","45s"],["Abdominal infra nas paralelas",3,"10-12","60s"]]]] },
  { id:"abc", nome:"ABC hipertrofia", nivel:"Intermediário", freq:3, local:"Academia", desc:"Divisão tradicional: peito e tríceps, costas e bíceps, pernas e ombros. Pode repetir para 6 dias.",
    dias:[["A","Peito e tríceps",[["Supino reto",4,"8-10","120s"],["Supino inclinado",3,"10-12","90s"],["Voador ou peck deck",3,"12-15","60s"],["Paralelas",3,"8-12","90s"],["Tríceps corda",3,"10-12","60s"],["Tríceps francês",3,"10-12","60s"]]],
          ["B","Costas e bíceps",[["Pulley costas",4,"8-10","120s"],["Remada curvada",3,"8-10","120s"],["Remada serrote",3,"10-12","90s"],["Pullover com halteres",3,"12","60s"],["Rosca direta com barra reta ou W",3,"10-12","60s"],["Rosca martelo",3,"10-12","60s"]]],
          ["C","Pernas e ombros",[["Agachamento livre",4,"8-10","150s"],["Leg press",3,"10-12","90s"],["Mesa flexora",3,"10-12","60s"],["Desenvolvimento com halteres",3,"8-12","90s"],["Elevação lateral com halteres",3,"12-15","60s"],["Elevação de panturrilhas em pé na máquina",4,"15","45s"]]]] },
  { id:"casa", nome:"Em casa sem equipamento", nivel:"Iniciante", freq:3, local:"Peso do corpo", desc:"Só com o peso do corpo, em qualquer lugar. Aumente as repetições ou deixe a descida mais lenta para progredir.",
    dias:[["Casa A","Corpo inteiro",[["Agachamento com peso do corpo",4,"15-20","60s"],["Flexão de braço",4,"8-15","60s"],["Remada invertida",3,"8-12","60s"],["Elevação pélvica",3,"15","45s"],["Prancha abdominal",3,"30-45s","45s"]]],
          ["Casa B","Corpo inteiro",[["Afundo",3,"12","60s"],["Flexão pike",3,"8-12","60s"],["Superman",3,"12-15","45s"],["Ponte unilateral",3,"12","45s"],["Mountain climber",3,"30s","30s"]]],
          ["Casa C","Condicionamento",[["Burpee",4,"10","60s"],["Flexão diamante",3,"8-12","60s"],["Agachamento com peso do corpo",3,"20","45s"],["Elevação de panturrilhas em pé com o peso do corpo",3,"20","30s"],["Hollow hold",3,"20-30s","45s"]]]] },
  { id:"halt", nome:"Só com halteres", nivel:"Iniciante", freq:3, local:"Halteres em casa", desc:"Para quem tem um par de halteres e um banco ou chão. Corpo inteiro, três vezes por semana.",
    dias:[["Halteres A","Corpo inteiro",[["Agachamento goblet",4,"10-12","90s"],["Supino com halteres no chão",4,"8-12","90s"],["Remada serrote",4,"10-12","90s"],["Stiff com halteres",3,"10-12","90s"],["Elevação lateral com halteres",3,"12-15","60s"]]],
          ["Halteres B","Corpo inteiro",[["Agachamento búlgaro",3,"10","90s"],["Desenvolvimento com halteres",4,"8-12","90s"],["Pullover com halteres",3,"12","60s"],["Agachamento sumô",3,"12","60s"],["Rosca alternada",3,"10-12","60s"],["Tríceps francês",3,"10-12","60s"]]]] },
  { id:"glut", nome:"Foco em glúteos e pernas", nivel:"Intermediário", freq:3, local:"Academia", desc:"Mais volume para glúteos e posteriores, com um dia de parte superior para manter o equilíbrio.",
    dias:[["Glúteos A","Glúteos e posterior",[["Elevação pélvica com barra",4,"8-12","120s"],["Levantamento terra romeno",3,"8-10","120s"],["Agachamento búlgaro",3,"10","90s"],["Extensão do quadril na polia",3,"15","60s"],["Mesa flexora",3,"12","60s"]]],
          ["Superior","Costas, peito e ombros",[["Pulley costas",3,"10-12","90s"],["Supino inclinado",3,"10-12","90s"],["Remada baixa",3,"10-12","90s"],["Elevação lateral com halteres",3,"12-15","60s"],["Prancha abdominal",3,"40s","45s"]]],
          ["Glúteos B","Quadríceps e glúteos",[["Agachamento livre",4,"8-10","150s"],["Leg press",3,"12","90s"],["Agachamento sumô",3,"12","60s"],["Passada",3,"15","45s"],["Mesa flexora",3,"12","60s"],["Elevação de panturrilhas em pé na máquina",3,"15","45s"]]]] },
];
let pgOpen = null;
function buildProgram(P){
  return { nome:P.nome, fonte:"pronto", observacoes:P.desc, dias:P.dias.map(([nome, foco, exs]) => ({ nome, foco, aquecimento:WARM.default, finalizacao:"",
    exercicios: exs.map(([n, sr, r, dsc]) => { const L = LIBMAP.get(n.toLowerCase()) || {}; return { nome:n, series:String(sr), reps:r, descanso:dsc, dica:L.dica || "", musculo:L.musc || "", nivel:L.nivel || 2 }; }) })) };
}
function renderPrograms(){
  $("#pg-list").innerHTML = PROGRAMS.map(P => { const open = pgOpen === P.id, using = state.plans.some(p => p.programa === P.id);
    return `<div class="pg"><button class="pg-h" data-pg="${P.id}" aria-expanded="${open}"><span><b>${esc(P.nome)}</b><span class="note">${P.freq}x por semana · ${esc(P.nivel)} · ${esc(P.local)}</span></span><span aria-hidden="true">${open ? "▴" : "▾"}</span></button>
      ${open ? `<p class="note" style="margin:0">${esc(P.desc)}</p>${P.dias.map(([n, f, exs]) => `<div class="pg-d"><b>${esc(n)}</b> <span class="note">· ${esc(f)}</span><div class="note" style="margin:0">${exs.map(([e, sr, r]) => `${esc(e)} ${sr}×${esc(r)}`).join(" · ")}</div></div>`).join("")}
      <button class="btn sm primary" data-use="${P.id}">${using ? "Usar de novo" : "Usar este programa"}</button>` : ""}</div>`; }).join("");
}
$("#pg-list").onclick = async e => {
  const h = e.target.closest("[data-pg]"); if (h){ pgOpen = pgOpen === h.dataset.pg ? null : h.dataset.pg; renderPrograms(); return; }
  const u = e.target.closest("[data-use]"); if (!u) return; const P = PROGRAMS.find(x => x.id === u.dataset.use), plan = buildProgram(P); plan.programa = P.id;
  const pf = { ...normProfile(state.profile), days: String(Math.min(6, P.freq)) };
  await addPlan(plan, state.profile ? { ...state.profile, days: pf.days } : pf); toast(`${P.nome} ativado. Bom treino!`);
};

/* ---------- comparar com amigo ---------- */
let cmpWho = "";
async function renderCompare(){
  const out = $("#cmp-out"); if (!out) return;
  if (!DB){ $("#cmp-who").innerHTML = ""; $("#cmp-who").closest("label").hidden = true; out.innerHTML = `<p class="note">A comparação precisa da sua conta do Claude. Nesta visualização ela não está disponível.</p>`; return; }
  const others = lgRows.filter(r => r.id !== UID);
  let names = {}; try { names = USERCAP ? await USERCAP.profiles([...others.map(r => r.id), UID]) : {}; } catch {}
  const nm = id => (names[id] && names[id].name) || "Atleta";
  $("#cmp-who").closest("label").hidden = !others.length;
  if (!others.length){ out.innerHTML = `<p class="note">Quando amigos entrarem na Liga Ironmind, você compara aqui seus números com os de cada um, exercício por exercício.</p>`; return; }
  if (!others.some(r => r.id === cmpWho)) cmpWho = others[0].id;
  $("#cmp-who").innerHTML = others.map(r => `<option value="${esc(r.id)}"${r.id === cmpWho ? " selected" : ""}>${esc(nm(r.id))}</option>`).join("");
  const me = myLeagueStats(), fr = others.find(r => r.id === cmpWho), cur = fr.semana === weekKey(), curM = fr.mes === me.mes;
  const tv = v => v >= 1000 ? `${(v/1000).toFixed(1).replace(".",",")} t` : `${v} kg`;
  const gen = [["Treinos na semana", me.treinosSemana, cur ? fr.treinosSemana : 0, String], ["Volume na semana", me.volumeSemana, cur ? fr.volumeSemana : 0, tv], ["Sequência", me.sequencia, fr.sequencia || 0, v => `${v} sem.`], ["Recordes no mês", me.recordesMes, curM ? fr.recordesMes : 0, String]];
  const common = Object.keys(me.forca || {}).filter(n => fr.forca && fr.forca[n]).map(n => [n, me.forca[n], fr.forca[n], v => `${v} kg`]).sort((a,b) => Math.max(b[1],b[2]) - Math.max(a[1],a[2]));
  const row = ([t, a, b, f]) => { const mx = Math.max(a, b, 1), w = a > b ? "a" : b > a ? "b" : "";
    return `<div class="cmp-r"><div class="cmp-t">${esc(t)}</div><div class="cmp-bars"><div class="cmp-bar me${w === "a" ? " win" : ""}"><i style="width:${(a/mx*100).toFixed(0)}%"></i><span>${f(a)}</span></div><div class="cmp-bar fr${w === "b" ? " win" : ""}"><i style="width:${(b/mx*100).toFixed(0)}%"></i><span>${f(b)}</span></div></div></div>`; };
  const wins = common.reduce((n,c) => n + (c[1] > c[2]), 0);
  out.innerHTML = `<div class="cmp-leg"><span><i class="me"></i>Você</span><span><i class="fr"></i>${esc(nm(cmpWho))}</span></div>${gen.map(row).join("")}
    <h3 style="margin-top:6px">Força por exercício (1RM estimado)</h3>
    ${common.length ? `<p class="note" style="margin:0">${common.length} ${common.length > 1 ? "exercícios" : "exercício"} em comum. Você está na frente em ${wins}.</p>${common.slice(0, 15).map(row).join("")}` : `<p class="note" style="margin:0">Vocês ainda não têm exercícios com carga em comum.</p>`}`;
}
$("#cmp-who").onchange = e => { cmpWho = e.target.value; renderCompare(); };

/* ---------- academia lotada ---------- */
function busyAlts(ex){
  const pf = normProfile(state.profile), info = infoOf(ex), have = new Set(wk.list.map(e => e.nome));
  return libVis().filter(e => e.musc === info.musc && e.nome !== ex.nome && !have.has(e.nome) && hasEquip(e.equip, pf.equip))
    .sort((a,b) => ((a.equip === info.equip) - (b.equip === info.equip)) || Math.abs(a.nivel - info.nivel) - Math.abs(b.nivel - info.nivel)).slice(0, 8);
}
const altRow = (e, why) => `<div class="exrow" style="grid-template-columns:44px minmax(0,1fr) auto"><div class="thumb fig" style="width:44px;height:44px">${figSVG(patternOf(e),1,{label:e.nome})}</div><div class="mid"><b>${esc(e.nome)}</b><span class="rx">${why ? esc(why) : esc(EQUIP[e.equip] || "Peso do corpo")}</span></div><button class="btn sm" data-swap="${esc(e.nome)}">Trocar</button></div>`;
function openBusy(){
  const ex = curEx(); if (!ex) return;
  $("#pl-busy-sub").textContent = `Troque ${ex.nome} por outro exercício do mesmo músculo só no treino de hoje. Séries já feitas ficam registradas.`;
  const alts = busyAlts(ex); $("#pl-busy-list").innerHTML = alts.map(e => altRow(e)).join("") || `<p class="note">Não achei alternativas com o seu equipamento.</p>`;
  $("#pl-busy-ai-out").innerHTML = ""; $("#pl-busy-ai").hidden = !sample; openSheet("pl-busy");
}
function swapEx(name){
  const L = wk.list, ex = curEx(), x = LIBMAP.get(String(name).toLowerCase()); if (!ex || !x) return;
  const done = ex.sets.filter(s => s.done).length, left = ex.sets.length - done;
  const nu = mkEx({ nome:x.nome, series:String(done ? Math.max(1, left) : ex.sets.length), reps:ex.reps, descanso:ex.descanso, dica:x.dica, musculo:x.musc, nivel:x.nivel });
  nu.descanso = ex.descanso; nu.ss = ex.ss;
  if (!done) L[wk.cur] = nu; else { ex.sets = ex.sets.filter(s => s.done); ex.ss = false; L.splice(wk.cur + 1, 0, nu); wk.cur++; }
  saveDraft(); closeSheet("pl-busy"); renderPlayer(); toast(`Trocado por ${x.nome}.`);
}
$("#pl-busy-open").onclick = openBusy;
$("#pl-busy").onclick = e => { const b = e.target.closest("[data-swap]"); if (b) swapEx(b.dataset.swap); };
$("#pl-busy-ai").onclick = async () => {
  const ex = curEx(), out = $("#pl-busy-ai-out"), btn = $("#pl-busy-ai"); if (!ex || !sample) return;
  const pf = normProfile(state.profile), info = infoOf(ex), have = new Set(wk.list.map(e => e.nome));
  const cands = libVis().filter(e => e.nome !== ex.nome && !have.has(e.nome) && hasEquip(e.equip, pf.equip) && e.musc !== "cardio" && e.musc !== "mobilidade").map(e => `${e.nome} (${MUSC[e.musc] || e.musc}, ${EQUIP[e.equip] || "peso do corpo"})`);
  btn.disabled = true; out.innerHTML = `<p class="note">Pensando…</p>`;
  try {
    const r = await sample.json(`Você é o coach do app Ironmind. O aparelho/estação de "${ex.nome}" (${MUSC[info.musc] || info.musc}, ${EQUIP[info.equip] || ""}) está ocupado na academia. O usuário faz ${ex.sets.length} séries de ${ex.reps}. Perfil: nível ${pf.level}, limitações: ${pf.limits || "nenhuma"}.
Escolha as 3 melhores substituições que trabalham o mesmo músculo com estímulo parecido, preferindo outro equipamento. Use SOMENTE nomes exatos desta lista:
${cands.join("\n")}
Responda SOMENTE com JSON: {"opcoes":[{"nome":"nome exato da lista","motivo":"1 frase curta em português"}]}`, { cache:false });
    const ops = (r?.opcoes || []).map(o => ({ e: LIBMAP.get(String(o.nome).toLowerCase()), m: o.motivo })).filter(o => o.e).slice(0, 3);
    out.innerHTML = ops.length ? `<div class="exlist">${ops.map(o => altRow(o.e, o.m)).join("")}</div>` : `<p class="note">O coach não trouxe opções válidas. Use a lista abaixo.</p>`;
  } catch (e) { out.innerHTML = `<p class="note">${e?.code === "not_granted" ? "Você não autorizou o uso da IA nesta página." : "Não consegui falar com o coach agora. Use a lista abaixo."}</p>`; }
  finally { btn.disabled = false; }
};

/* ---------- hidratação ---------- */
let WATER = { meta:null, dias:{}, log:[] };
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function waterAuto(){ const w = parseFloat(normProfile(state.profile).weight) || 0, base = w ? Math.round(w * 35 / 50) * 50 : 2500, trained = state.sessions.some(s => ymd(new Date(s.date)) === ymd()); return { base, total: base + (trained ? 500 : 0), trained, w }; }
const waterGoal = () => +WATER.meta || waterAuto().total;
function renderWater(){
  if (!$("#wt-card")) return;
  const ml = +WATER.dias[ymd()] || 0, goal = waterGoal(), a = waterAuto(), pct = Math.min(100, ml / goal * 100);
  $("#wt-ml").textContent = `${ml.toLocaleString("pt-BR")} ml`;
  $("#wt-goal").textContent = ml >= goal ? `Meta de ${goal.toLocaleString("pt-BR")} ml batida! 💧` : `de ${goal.toLocaleString("pt-BR")} ml · faltam ${(goal - ml).toLocaleString("pt-BR")} ml`;
  $("#wt-bar").style.width = pct.toFixed(0) + "%";
  const cups = Math.ceil(goal / 250), full = Math.floor(ml / 250);
  $("#wt-cups").innerHTML = Array.from({ length: Math.min(cups, 14) }, (_, i) => `<span class="cup${i < full ? " on" : ""}"></span>`).join("");
  $("#wt-undo").disabled = !(WATER.log || []).some(x => x.d === ymd());
  $("#wt-auto").textContent = `Automática: ${a.w ? `35 ml por kg (${a.w} kg) = ${a.base.toLocaleString("pt-BR")} ml` : `2.500 ml (informe seu peso no Perfil para calcular)`}, mais 500 ml nos dias de treino${a.trained ? " (hoje você treinou)" : ""}.`;
  if (document.activeElement !== $("#wt-meta")) $("#wt-meta").value = WATER.meta || "";
}
let wtSaveT = null;
function saveWater(){ clearTimeout(wtSaveT); wtSaveT = setTimeout(async () => { try { await store.set("agua", WATER); } catch { toast("Não consegui salvar a água agora."); } }, 500); }
$("#wt-card").onclick = e => {
  const b = e.target.closest("[data-wt]");
  if (b){ const k = ymd(), add = +b.dataset.wt, before = +WATER.dias[k] || 0; WATER.dias[k] = before + add; WATER.log = [...(WATER.log || []).filter(x => x.d === k), { d:k, ml:add }].slice(-30);
    const dd = Object.keys(WATER.dias).sort(); if (dd.length > 60) dd.slice(0, dd.length - 60).forEach(x => delete WATER.dias[x]);
    if (before < waterGoal() && WATER.dias[k] >= waterGoal()){ toast("Meta de água batida! 💧"); tone(1047, .15, .2); tone(1568, .3, .2, .15); }
    saveWater(); renderWater(); renderToday(); return; }
  if (e.target.closest("#wt-undo")){ const k = ymd(), i = (WATER.log || []).map(x => x.d).lastIndexOf(k); if (i < 0) return; const x = WATER.log.splice(i, 1)[0]; WATER.dias[k] = Math.max(0, (+WATER.dias[k] || 0) - x.ml); saveWater(); renderWater(); return; }
  if (e.target.closest("#wt-cfg-btn")){ const f = $("#wt-cfg"); f.hidden = !f.hidden; $("#wt-cfg-btn").setAttribute("aria-expanded", !f.hidden); renderWater(); return; }
  if (e.target.closest("#wt-save")){ const v = parseInt($("#wt-meta").value); WATER.meta = v >= 500 && v <= 8000 ? v : null; saveWater(); renderWater(); toast(WATER.meta ? "Meta de água salva." : "Meta automática ativada."); return; }
  if (e.target.closest("#wt-ics")) waterIcs();
};
async function waterIcs(){
  const [fh, fm] = ($("#wt-from").value || "08:00").split(":").map(Number), [th, tm] = ($("#wt-to").value || "20:00").split(":").map(Number), every = +$("#wt-every").value || 120;
  const p2 = n => String(n).padStart(2,"0"), now = new Date(), stamp = `${now.getUTCFullYear()}${p2(now.getUTCMonth()+1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}00Z`;
  const day = `${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}`, ev = [];
  for (let m = fh*60 + fm, i = 0; m <= th*60 + tm && i < 16; m += every, i++){
    const t = `${p2(Math.floor(m/60))}${p2(m%60)}00`, t2 = `${p2(Math.floor((m+5)/60))}${p2((m+5)%60)}00`;
    ev.push("BEGIN:VEVENT", `UID:ironmind-agua-${i}-${Date.now()}@treino`, `DTSTAMP:${stamp}`, `DTSTART:${day}T${t}`, `DTEND:${day}T${t2}`, "RRULE:FREQ=DAILY", "SUMMARY:💧 Beber água", `DESCRIPTION:Meta do dia: ${waterGoal()} ml. Registre no Ironmind.`, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Beber água", "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
  }
  if (!ev.length){ toast("Confira os horários."); return; }
  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Ironmind//Agua//PT","CALSCALE:GREGORIAN", ...ev, "END:VCALENDAR"].join("\r\n");
  if (!DOWNLOADS){ toast("Baixar arquivos não está disponível nesta visualização."); return; }
  try { await DOWNLOADS.save({ filename:"ironmind-agua.ics", data:new Blob([ics], { type:"text/calendar" }) }); toast("Abra o arquivo baixado para adicionar ao calendário."); } catch { toast("Download cancelado."); }
}

/* ---------- cartão para compartilhar ---------- */
let shBlob = null, shName = "";
async function makeCard(s){
  try { await Promise.all(['800 80px "Barlow Condensed"', '600 40px Lexend', '600 30px Barlow', '400 30px Barlow'].map(f => document.fonts.load(f))); } catch {}
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#1b120d"); bg.addColorStop(1, "#33170a"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W*.85, H*.08, 10, W*.85, H*.08, 600); glow.addColorStop(0, "rgba(255,106,43,.35)"); glow.addColorStop(1, "rgba(255,106,43,0)"); g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const acc = g.createLinearGradient(0, 0, 400, 0); acc.addColorStop(0, "#ff4d2e"); acc.addColorStop(1, "#ffa62b");
  const hex = (x, y, r) => { g.beginPath(); for (let i = 0; i < 6; i++){ const a = Math.PI/3*i - Math.PI/2; g[i ? "lineTo" : "moveTo"](x + r*Math.cos(a), y + r*Math.sin(a)); } g.closePath(); };
  g.save(); g.translate(80, 0); hex(36, 110, 34); g.fillStyle = acc; g.fill();
  g.fillStyle = "#1b120d"; [[36,92],[22,118],[50,118]].forEach(([x,y]) => { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }); g.strokeStyle = "#1b120d"; g.lineWidth = 4; g.beginPath(); g.moveTo(36,92); g.lineTo(22,118); g.lineTo(50,118); g.closePath(); g.stroke(); g.restore();
  g.fillStyle = "#fff"; g.font = '600 44px Lexend, sans-serif'; g.textBaseline = "middle"; g.fillText("ironmind", 170, 112);
  g.fillStyle = "rgba(255,255,255,.65)"; g.font = '400 30px Barlow, sans-serif'; g.textAlign = "right"; g.fillText(new Date(s.date).toLocaleDateString("pt-BR", { day:"numeric", month:"long", year:"numeric" }), W - 80, 112); g.textAlign = "left";
  g.fillStyle = "#ffa62b"; g.font = '700 34px "Barlow Condensed", sans-serif'; g.fillText("TREINO CONCLUÍDO", 80, 230);
  g.fillStyle = "#fff"; g.font = '800 104px "Barlow Condensed", sans-serif'; let title = String(s.dia || "Treino").toUpperCase(); while (g.measureText(title).width > W - 160 && title.length > 4) title = title.slice(0, -2) + "…"; g.fillText(title, 80, 320);
  const vol = Math.round(sessVol(s)), stats = [[`${sessDur(s)}`, "min", "Duração"], [vol >= 1000 ? (vol/1000).toFixed(1).replace(".", ",") : String(vol), vol >= 1000 ? "t" : "kg", "Volume"], [String(s.exercicios.reduce((n,e) => n + e.sets.length, 0)), "", "Séries"]];
  stats.forEach(([v, u, l], i) => { const x = 80 + i * 320; g.fillStyle = "rgba(255,255,255,.07)"; g.beginPath(); g.roundRect ? g.roundRect(x, 400, 290, 170, 22) : g.rect(x, 400, 290, 170); g.fill();
    g.fillStyle = "#fff"; g.font = '800 84px "Barlow Condensed", sans-serif'; g.fillText(v, x + 28, 470); const vw = g.measureText(v).width; g.fillStyle = "#ffa62b"; g.font = '700 40px "Barlow Condensed", sans-serif'; g.fillText(u, x + 36 + vw, 482);
    g.fillStyle = "rgba(255,255,255,.6)"; g.font = '600 28px Barlow, sans-serif'; g.fillText(l, x + 28, 535); });
  let y = 640; const prs = s.prs || [];
  if (prs.length){ g.fillStyle = acc; g.beginPath(); g.roundRect ? g.roundRect(80, y - 40, W - 160, 70 + Math.min(prs.length, 3) * 48, 22) : g.rect(80, y - 40, W - 160, 70 + Math.min(prs.length, 3) * 48); g.fill();
    g.fillStyle = "#1b120d"; g.font = '800 40px "Barlow Condensed", sans-serif'; g.fillText(`🏆 ${prs.length > 1 ? prs.length + " RECORDES PESSOAIS" : "RECORDE PESSOAL"}`, 110, y); g.font = '600 32px Barlow, sans-serif';
    prs.slice(0, 3).forEach((p, i) => g.fillText(`${p.nome}: ${String(p.valor).replace(".", ",")} kg${p.tipo === "1rm" ? " (1RM est.)" : ""}`, 110, y + 52 + i * 48)); y += 90 + Math.min(prs.length, 3) * 48; }
  g.fillStyle = "rgba(255,255,255,.6)"; g.font = '700 30px "Barlow Condensed", sans-serif'; g.fillText("EXERCÍCIOS", 80, y); y += 52;
  const maxRows = Math.max(2, Math.floor((H - 150 - y) / 58));
  s.exercicios.slice(0, maxRows).forEach(e => { const b = e.sets.reduce((a,x) => (+x.kg > +a.kg || (+x.kg === +a.kg && +x.reps > +a.reps)) ? x : a, e.sets[0] || { kg:0, reps:0 });
    g.fillStyle = "#fff"; g.font = '600 34px Barlow, sans-serif'; let n = e.nome; while (g.measureText(n).width > 620 && n.length > 4) n = n.slice(0, -2) + "…"; g.fillText(n, 80, y);
    g.textAlign = "right"; g.fillStyle = "#ffa62b"; g.font = '700 36px "Barlow Condensed", sans-serif'; g.fillText(+b.kg ? `${e.sets.length} × ${b.reps} · ${String(b.kg).replace(".", ",")} kg` : `${e.sets.length} × ${b.reps}`, W - 80, y); g.textAlign = "left";
    g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(80, y + 28, W - 160, 2); y += 58; });
  if (s.exercicios.length > maxRows){ g.fillStyle = "rgba(255,255,255,.6)"; g.font = '400 28px Barlow, sans-serif'; g.fillText(`e mais ${s.exercicios.length - maxRows}`, 80, y); }
  g.fillStyle = "rgba(255,255,255,.5)"; g.font = '400 28px Barlow, sans-serif'; g.fillText("Registrado no Ironmind", 80, H - 70);
  return await new Promise(r => c.toBlob(r, "image/png"));
}
async function openCard(s){
  openSheet("sh-card"); $("#sh-img").removeAttribute("src"); $("#sh-save").disabled = true;
  shBlob = await makeCard(s); shName = `ironmind-${ymd(new Date(s.date))}.png`;
  $("#sh-img").src = URL.createObjectURL(shBlob); $("#sh-save").disabled = false;
  let can = false; try { can = !!navigator.canShare?.({ files:[new File([shBlob], shName, { type:"image/png" })] }); } catch {}
  $("#sh-share").hidden = !can;
}
$("#sh-save").onclick = async () => { if (!shBlob) return; if (!DOWNLOADS){ toast("Baixar arquivos não está disponível nesta visualização."); return; }
  try { await DOWNLOADS.save({ filename: shName, data: shBlob }); toast("Imagem salva. Agora é só postar!"); } catch { toast("Download cancelado."); } };
$("#sh-share").onclick = async () => { try { await navigator.share({ files:[new File([shBlob], shName, { type:"image/png" })], text:"Treino concluído no Ironmind 💪" }); } catch {} };

/* ---------- previsão de metas ---------- */
let GOALS_L = [];
function goalSeries(gl){
  if (gl.tipo === "peso") return (state.measures || []).filter(m => m.tipo === "peso").map(m => [Date.parse(m.date), +m.valor]).sort((a,b) => a[0]-b[0]);
  return state.sessions.map(s => { const e = s.exercicios.find(x => x.nome === gl.ex); const kg = e ? Math.max(0, ...e.sets.map(x => +x.kg || 0)) : 0; return kg ? [Date.parse(s.date), kg] : null; }).filter(Boolean).sort((a,b) => a[0]-b[0]);
}
function monthInfo(){ const n = new Date(), a = new Date(n.getFullYear(), n.getMonth(), 1), b = new Date(n.getFullYear(), n.getMonth() + 1, 1); return { a, b, mes: ymd(a).slice(0,7), passed: Math.max(1, (n - a) / 864e5), total: (b - a) / 864e5 }; }
function monthGoal(gl){
  const M = monthInfo(), S = state.sessions.filter(s => { const t = Date.parse(s.date); return t >= +M.a && t < +M.b; });
  const cur = gl.tipo === "treinos" ? S.length : Math.round(S.reduce((x, s) => x + sessVol(s), 0)), f = v => gl.tipo === "treinos" ? `${v} ${v === 1 ? "treino" : "treinos"}` : `${(v/1000).toFixed(1).replace(".", ",")} t`;
  const proj = Math.round(cur / M.passed * M.total), left = Math.ceil(M.total - M.passed);
  const msg = cur >= gl.alvo ? "Meta do mês batida! 🎉" : `Faltam ${f(gl.alvo - cur)} em ${left} ${left === 1 ? "dia" : "dias"}. No ritmo atual você termina o mês com <b>${f(proj)}</b>${proj >= gl.alvo ? ", acima da meta." : `. Precisa de cerca de ${gl.tipo === "treinos" ? Math.ceil((gl.alvo - cur) / Math.max(1, left/7)) + " treinos por semana" : f(Math.round((gl.alvo - cur) / Math.max(1, left/7))) + " por semana"}.`}`;
  return { cur, done: cur >= gl.alvo, msg, f, pct: Math.min(100, cur / gl.alvo * 100) };
}
function goalPredict(gl){
  const pts = goalSeries(gl), up = gl.alvo >= (gl.inicio ?? (pts[0]?.[1] ?? 0));
  if (!pts.length) return { cur:null, msg: gl.tipo === "peso" ? "Registre seu peso em Medidas para acompanhar." : "Faça esse exercício com carga para começar a previsão." };
  const cur = pts.at(-1)[1];
  if (up ? cur >= gl.alvo : cur <= gl.alvo) return { cur, done:true, msg:"Meta alcançada! 🎉" };
  const recent = pts.filter(p => p[0] >= pts.at(-1)[0] - 120 * 864e5);
  if (recent.length < 3 || recent.at(-1)[0] - recent[0][0] < 10 * 864e5) return { cur, msg:`Faltam ${String(Math.abs(+(gl.alvo - cur).toFixed(1))).replace(".", ",")} kg. Registre mais alguns ${gl.tipo === "peso" ? "pesos" : "treinos"} em dias diferentes para eu calcular a previsão.` };
  const n = recent.length, xs = recent.map(p => (p[0] - recent[0][0]) / 864e5), ys = recent.map(p => p[1]), mx = xs.reduce((a,b) => a+b)/n, my = ys.reduce((a,b) => a+b)/n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
  const perWeek = slope * 7, need = gl.alvo - cur;
  if (Math.abs(perWeek) < 0.05 || Math.sign(perWeek) !== Math.sign(need)) return { cur, slope, msg:`No ritmo atual você está ${Math.abs(perWeek) < 0.05 ? "estável" : "se afastando da meta"} (${perWeek >= 0 ? "+" : ""}${perWeek.toFixed(1).replace(".", ",")} kg por semana). Ajuste ${gl.tipo === "peso" ? "alimentação e treino" : "a progressão de carga"} para voltar a avançar.` };
  const days = need / slope, when = new Date(Date.now() + days * 864e5);
  if (days > 730) return { cur, slope, msg:`No ritmo atual (${perWeek >= 0 ? "+" : ""}${perWeek.toFixed(1).replace(".", ",")} kg/semana) leva mais de 2 anos.` };
  const wk2 = Math.round(days / 7);
  return { cur, slope, msg:`No ritmo atual (${perWeek >= 0 ? "+" : ""}${perWeek.toFixed(1).replace(".", ",")} kg/semana), você chega lá por volta de <b>${when.toLocaleDateString("pt-BR", { day:"numeric", month:"long", year: when.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined })}</b> (${wk2 <= 1 ? "cerca de 1 semana" : `cerca de ${wk2} semanas`}).` };
}
function renderGoals(){
  if (!$("#gl-list")) return;
  const names = [...new Set(state.sessions.flatMap(s => s.exercicios.filter(e => e.sets.some(x => +x.kg)).map(e => e.nome)))];
  if (document.activeElement !== $("#gl-ex")) $("#gl-ex").innerHTML = names.length ? names.map(n => `<option>${esc(n)}</option>`).join("") : `<option value="">Faça treinos com carga primeiro</option>`;
  const gt = $("#gl-type").value; $("#gl-ex-l").hidden = gt !== "carga";
  $("#gl-alvo-t").textContent = gt === "treinos" ? "Quantos treinos neste mês" : gt === "volume" ? "Volume no mês (kg)" : "Meta (kg)"; $("#gl-alvo").placeholder = gt === "treinos" ? "Ex.: 16" : gt === "volume" ? "Ex.: 40000" : "Ex.: 100";
  const mes = monthInfo().mes, mesNome = new Date().toLocaleDateString("pt-BR", { month:"long" });
  $("#gl-list").innerHTML = GOALS_L.length ? GOALS_L.filter(gl => !(gl.mes && gl.mes !== mes)).map(gl => {
    if (gl.mes){ const m = monthGoal(gl);
      return `<div class="gl"><div class="row between" style="flex-wrap:nowrap;gap:8px"><b>${gl.tipo === "treinos" ? `${gl.alvo} treinos em ${mesNome}` : `${m.f(gl.alvo)} de volume em ${mesNome}`}</b><button class="mini" data-gl-del="${gl.id}" aria-label="Remover meta">✕</button></div>
        <div class="note" style="margin:0">Até agora: ${m.f(m.cur)} · meta do mês</div><div class="ach-bar"><i style="width:${m.pct.toFixed(0)}%"></i></div><div class="gl-msg">${m.msg}</div></div>`; }
    const p = goalPredict(gl), start = gl.inicio ?? p.cur ?? 0, span = gl.alvo - start, pct = p.done ? 100 : p.cur == null || !span ? 0 : Math.max(0, Math.min(100, (p.cur - start) / span * 100));
    return `<div class="gl"><div class="row between" style="flex-wrap:nowrap;gap:8px"><b>${gl.tipo === "peso" ? "Peso corporal" : esc(gl.ex)} → ${String(gl.alvo).replace(".", ",")} kg</b><button class="mini" data-gl-del="${gl.id}" aria-label="Remover meta">✕</button></div>
      <div class="note" style="margin:0">Agora: ${p.cur == null ? "—" : String(p.cur).replace(".", ",") + " kg"} · início: ${String(start).replace(".", ",")} kg</div>
      <div class="ach-bar"><i style="width:${pct.toFixed(0)}%"></i></div><div class="gl-msg">${p.msg}</div>
      ${sample && !p.done ? `<button class="mini" data-gl-ai="${gl.id}">Dica do coach IA</button><div class="ans" id="gl-ai-${gl.id}"></div>` : ""}</div>`; }).join("")
    : `<p class="note">Defina metas do mês, como 16 treinos, ou metas de longo prazo, como 100 kg no supino ou 80 kg de peso corporal. O app mostra o progresso e calcula quando você deve chegar lá.</p>`;
}
async function saveGoals(){ try { await store.set("metas", GOALS_L); } catch { toast("Não consegui salvar a meta."); } }
$("#gl-new").onclick = () => { const f = $("#gl-form"); f.hidden = !f.hidden; $("#gl-new").setAttribute("aria-expanded", !f.hidden); renderGoals(); };
$("#gl-type").onchange = renderGoals;
$("#gl-add").onclick = async () => {
  const tipo = $("#gl-type").value, ex = $("#gl-ex").value, alvo = parseFloat(String($("#gl-alvo").value).replace(",", "."));
  if (!(alvo > 0)){ toast("Informe o valor da meta."); return; } if (tipo === "carga" && !ex){ toast("Escolha um exercício."); return; }
  const gl = { id: Date.now().toString(36), tipo, ...(tipo === "carga" ? { ex } : {}), ...(tipo === "treinos" || tipo === "volume" ? { mes: monthInfo().mes } : {}), alvo: tipo === "treinos" ? Math.round(alvo) : alvo, criado: new Date().toISOString() };
  if (gl.mes){ GOALS_L = [...GOALS_L.filter(g => !(g.mes && g.mes !== gl.mes && Date.parse(g.criado) < Date.now() - 400*864e5)), gl]; $("#gl-alvo").value = ""; $("#gl-form").hidden = true; $("#gl-new").setAttribute("aria-expanded", "false"); renderGoals(); await saveGoals(); toast("Meta do mês criada."); return; }
  const pts = goalSeries(gl); if (pts.length) gl.inicio = pts.at(-1)[1];
  GOALS_L = [...GOALS_L, gl]; $("#gl-alvo").value = ""; $("#gl-form").hidden = true; $("#gl-new").setAttribute("aria-expanded", "false"); renderGoals(); await saveGoals(); toast("Meta criada.");
};
$("#gl-list").onclick = async e => {
  const del = e.target.closest("[data-gl-del]"); if (del){ GOALS_L = GOALS_L.filter(g => g.id !== del.dataset.glDel); renderGoals(); await saveGoals(); return; }
  const ai = e.target.closest("[data-gl-ai]"); if (!ai || !sample) return; const gl = GOALS_L.find(g => g.id === ai.dataset.glAi), out = $("#gl-ai-" + gl.id), p = goalPredict(gl);
  const pts = goalSeries(gl).slice(-12).map(([t, v]) => `${new Date(t).toLocaleDateString("pt-BR")}: ${v} kg`).join("; ");
  ai.disabled = true; out.textContent = "Pensando…";
  try { await sample(`Você é o coach do app Ironmind. Em português do Brasil, no máximo 4 frases práticas, sem inventar dados.
Perfil: ${JSON.stringify(normProfile(state.profile))}
Meta: ${gl.tipo === "peso" ? "peso corporal" : "carga máxima em " + gl.ex} de ${gl.alvo} kg. Histórico recente: ${pts || "sem dados"}.
Previsão do app: ${p.msg.replace(/<[^>]+>/g, "")}
Diga se a previsão é realista e o que fazer nas próximas semanas para chegar lá com segurança.`, { onText: ({text}) => { out.textContent = text; }, cache:false }); }
  catch (er) { out.textContent = er?.code === "not_granted" ? "Você não autorizou o uso da IA nesta página." : "Não consegui responder agora."; }
  finally { ai.disabled = false; }
};

/* ---------- timer de cadência ---------- */
let cad = null;
function cadStop(msg){ if (!cad) return; clearInterval(cad.t); cad = null; $("#cad-ov").hidden = true; $("#pl-cad").setAttribute("aria-pressed", "false"); if (msg) toast(msg); }
function cadStart(){
  unlockAudio(); const ex = curEx(); if (!ex) return;
  const [dn, ps, up] = String(CFG.cad || "3-0-1").split("-").map(Number), per = dn + ps + up, i = ex.sets.findIndex(x => !x.done);
  const rI = i >= 0 ? $(`#pl-rows input[data-s="${i}"][data-f="reps"]`) : null, reps = parseInt(rI?.value || rI?.placeholder) || topReps(ex.reps);
  cad = { t0: performance.now() + 2000, dn, ps, up, per, reps, last: "" };
  $("#cad-ov").hidden = false; $("#pl-cad").setAttribute("aria-pressed", "true"); $("#cad-ph").textContent = "Prepare-se"; $("#cad-n").textContent = "2"; $("#cad-rep").textContent = `${reps} repetições · ${CFG.cad || "3-0-1"}`;
  say(`Cadência ${ptInt(dn)}, ${ptInt(ps)}, ${ptInt(up)}. ${ptF(reps)} repetições.`, true);
  cad.t = setInterval(cadTick, 100);
}
function cadTick(){
  if (!cad) return; const el = (performance.now() - cad.t0) / 1000;
  if (el < 0){ const n = Math.ceil(-el); if (cad.last !== "p" + n){ cad.last = "p" + n; $("#cad-n").textContent = n; tone(520, .08, .15); } return; }
  const rep = Math.floor(el / cad.per), inRep = el - rep * cad.per;
  if (rep >= cad.reps){ tone(988, .5, .25); say("Série completa!", true); cadStop(); return; }
  const ph = inRep < cad.dn ? "d" : inRep < cad.dn + cad.ps ? "p" : "u", sec = Math.floor(inRep - (ph === "d" ? 0 : ph === "p" ? cad.dn : cad.dn + cad.ps)), key = rep + ph + sec;
  if (key === cad.last) return; cad.last = key;
  const len = ph === "d" ? cad.dn : ph === "p" ? cad.ps : cad.up;
  $("#cad-ph").textContent = ph === "d" ? "Desce" : ph === "p" ? "Segura" : "Sobe"; $("#cad-n").textContent = len - sec;
  $("#cad-rep").textContent = `Repetição ${rep + 1} de ${cad.reps}`; $("#cad-ov").dataset.ph = ph;
  if (ph === "d") tone(sec ? 440 : 392, sec ? .06 : .12, .18); else if (ph === "p") tone(587, .06, .14); else tone(sec ? 784 : 880, sec ? .06 : .14, .22);
}
$("#pl-cad").onclick = () => { cad ? cadStop() : cadStart(); };

/* ---------- músculos da semana e volume ideal ---------- */
function idealRange(){
  const pf = normProfile(state.profile), g = pf.goals[0];
  let r = ["hipertrofia","definicao","emagrecimento"].includes(g) ? [10, 20] : ["forca","esporte"].includes(g) ? [8, 15] : [6, 12];
  if (pf.level === "iniciante") r = [Math.min(r[0], 6), Math.min(r[1], 14)];
  return r;
}
function weekSets(){ const from = Date.now() - 7*864e5, cnt = Object.fromEntries(MUSCLES.map(m => [m, 0]));
  state.sessions.filter(s => Date.parse(s.date) >= from).forEach(s => s.exercicios.forEach(e => { const m = e.musculo && cnt[e.musculo] !== undefined ? e.musculo : infoOf(e).musc; if (cnt[m] !== undefined) cnt[m] += e.sets.length; })); return cnt; }
const mwStatus = (v, [a, b]) => !v ? ["esq", "Esquecido", "var(--mus)"] : v < a ? ["pouco", "Pouco", "#f4a582"] : v > b ? ["demais", "Demais", "#9b1c2c"] : ["ideal", "Ideal", "var(--accent)"];
function renderMuscleWeek(){
  if (!$("#mw-card")) return;
  const cnt = weekSets(), R = idealRange(), st = Object.fromEntries(MUSCLES.map(m => [m, mwStatus(cnt[m], R)])), fills = Object.fromEntries(MUSCLES.map(m => [m, st[m][2]]));
  $("#mw-sub").textContent = `Séries por músculo nos últimos 7 dias. Faixa ideal para o seu objetivo: ${R[0]} a ${R[1]} séries por semana.`;
  $("#mw-maps").innerHTML = `<figure>${bodySVG("f", fills, "Frente: músculos treinados na semana")}<figcaption>Frente</figcaption></figure><figure>${bodySVG("b", fills, "Costas: músculos treinados na semana")}<figcaption>Costas</figcaption></figure>`;
  const ok = MUSCLES.filter(m => st[m][0] === "ideal").length, forgot = MUSCLES.filter(m => !cnt[m]);
  $("#mw-tag").textContent = `${ok} de ${MUSCLES.length} no ideal`;
  const mx = Math.max(R[1] * 1.3, ...Object.values(cnt));
  $("#mw-list").innerHTML = (forgot.length && state.sessions.length ? `<p class="mw-warn">Esquecidos nesta semana: ${forgot.map(m => MUSC[m]).join(", ")}.</p>` : "") +
    MUSCLES.slice().sort((a,b) => ({esq:0,pouco:1,demais:2,ideal:3}[st[a][0]] - {esq:0,pouco:1,demais:2,ideal:3}[st[b][0]]) || cnt[b] - cnt[a]).map(m => `<div class="mw-r"><span>${MUSC[m]}</span>
      <div class="mw-bar"><span class="band" style="left:${(R[0]/mx*100).toFixed(1)}%;width:${((R[1]-R[0])/mx*100).toFixed(1)}%"></span><i style="width:${(Math.min(cnt[m], mx)/mx*100).toFixed(1)}%;background:${st[m][2] === "var(--mus)" ? "transparent" : st[m][2]}"></i></div>
      <span class="mw-v">${cnt[m]}</span><span class="mw-s ${st[m][0]}">${st[m][1]}</span></div>`).join("");
  $("#mw-ai").hidden = !sample || !state.sessions.length;
}
$("#mw-ai").onclick = async () => {
  if (!sample) return; const out = $("#mw-ai-out"), b = $("#mw-ai"), cnt = weekSets(), R = idealRange();
  b.disabled = true; out.textContent = "Pensando…";
  try { await sample(`Você é o coach do app Ironmind. Em português do Brasil, no máximo 5 frases curtas com "•", sem inventar dados.
Perfil: ${JSON.stringify(normProfile(state.profile))}
Séries por músculo nos últimos 7 dias: ${MUSCLES.map(m => `${MUSC[m]} ${cnt[m]}`).join(", ")}. Faixa recomendada: ${R[0]}-${R[1]} séries/semana.
Plano ativo: ${activePlan().nome} (${activePlan().dias.map(d => d.nome).join(", ")}).
Diga quais músculos estão com pouco ou volume demais e o ajuste prático para a próxima semana (quais exercícios ou séries adicionar ou tirar).`, { onText: ({text}) => { out.textContent = text; }, cache:false }); }
  catch (e) { out.textContent = e?.code === "not_granted" ? "Você não autorizou o uso da IA nesta página." : "Não consegui responder agora."; }
  finally { b.disabled = false; }
};

/* ---------- treinos sem internet ---------- */
let PENDING = [];
try { PENDING = JSON.parse(localStorage.getItem("forja:pending")) || []; } catch { PENDING = []; }
function savePending(){ try { localStorage.setItem("forja:pending", JSON.stringify(PENDING)); } catch {} showSync(); }
function showSync(){ if (!store) return; const base = store.kind === "db" ? "Salvo na sua conta" : "Salvo neste aparelho"; $("#sync").textContent = PENDING.length ? `${PENDING.length} ${PENDING.length > 1 ? "treinos aguardando" : "treino aguardando"} envio` : base; $("#sync").classList.toggle("pend", !!PENDING.length); }
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);
let flushing = false;
async function flushPending(){
  if (flushing || !PENDING.length || !store || navigator.onLine === false) return; flushing = true; let sent = 0;
  try { for (const s of PENDING.slice()){ try { await withTimeout(store.addSession(s), 10000); PENDING = PENDING.filter(x => x.date !== s.date); sent++; } catch { break; } } }
  finally { flushing = false; savePending(); }
  if (sent){ toast(`${sent} ${sent > 1 ? "treinos enviados" : "treino enviado"} para a sua conta.`); publishLeague(); publishFeed(); }
}
window.addEventListener("online", () => setTimeout(flushPending, 1500));
window.addEventListener("offline", () => toast("Sem internet. Pode continuar o treino: ele fica guardado e é enviado depois."));
setInterval(() => { if (PENDING.length) flushPending(); }, 60000);

/* ---------- resumo das medidas ---------- */
function renderMeasureSum(){
  const box = $("#m-sum"); if (!box) return; const M = state.measures || [];
  const rows = Object.entries(MKINDS).map(([k, [t, u]]) => { const p = M.filter(m => m.tipo === k).sort((a,b) => a.date.localeCompare(b.date)); if (!p.length) return null;
    const last = +p.at(-1).valor, first = +p[0].valor, d = +(last - first).toFixed(1); return { k, t, u, last, d, n:p.length }; }).filter(Boolean);
  box.innerHTML = rows.length ? rows.map(r => `<button class="msum${r.k === mKind ? " on" : ""}" data-k="${r.k}"><span>${r.t}</span><b>${String(r.last).replace(".", ",")} ${r.u}</b><small class="${r.d > 0 ? "up" : r.d < 0 ? "down" : ""}">${r.n > 1 ? `${r.d > 0 ? "▲ +" : r.d < 0 ? "▼ " : ""}${String(r.d).replace(".", ",")} ${r.u} desde o início` : "1 registro"}</small></button>`).join("") : "";
}

/* ---------- saúde: Apple Saúde / Google Fit ---------- */
let HEALTH = { dias:{}, importado:null, fonte:"" };
function loadScript(src){ return new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = src; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); }); }
async function* chunksOf(file){ const rd = file.stream().pipeThrough(new TextDecoderStream()).getReader(); for (;;){ const { value, done } = await rd.read(); if (done) return; yield value; } }
function appleParser(sinceMs){
  const W = {}, ST = {}, SL = {}; let buf = "", n = 0;
  const attr = (t, k) => { const m = t.match(new RegExp(" " + k + '="([^"]*)"')); return m ? m[1] : null; };
  const day = str => str.slice(0, 10);
  function rec(t){
    const ty = attr(t, "type"); if (!ty) return;
    const isW = ty === "HKQuantityTypeIdentifierBodyMass", isS = ty === "HKQuantityTypeIdentifierStepCount", isSl = ty === "HKCategoryTypeIdentifierSleepAnalysis"; if (!isW && !isS && !isSl) return;
    const st = attr(t, "startDate"), en = attr(t, "endDate") || st; if (!st) return; const t0 = Date.parse(st.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2")); if (!(t0 >= sinceMs)) return;
    n++; const src = attr(t, "sourceName") || "?";
    if (isW){ let v = parseFloat(attr(t, "value")); const u = attr(t, "unit"); if (u === "lb") v *= 0.453592; if (v > 20 && v < 400) W[day(st)] = Math.round(v * 10) / 10; }
    else if (isS){ const v = parseFloat(attr(t, "value")) || 0, k = day(st); (ST[k] = ST[k] || {})[src] = (ST[k][src] || 0) + v; }
    else { const val = attr(t, "value") || "", t1 = Date.parse(en.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2")), min = (t1 - t0) / 6e4; if (!(min > 0)) return;
      const kind = /Asleep/.test(val) ? "a" : /InBed/.test(val) ? "b" : null; if (!kind) return; const k = day(en); SL[k] = SL[k] || {}; const key = src + kind; SL[k][key] = (SL[k][key] || 0) + min; }
  }
  return { push(chunk){ buf += chunk; const re = /<Record\b[^>]*>/g; let m, last = 0; while ((m = re.exec(buf))){ rec(m[0]); last = re.lastIndex; } const cut = buf.lastIndexOf("<Record"); buf = cut >= last ? buf.slice(cut) : buf.slice(Math.max(last, buf.length - 2000)); },
    done(){ const out = {}; for (const [k, v] of Object.entries(W)) (out[k] = out[k] || {}).peso = v;
      for (const [k, srcs] of Object.entries(ST)) (out[k] = out[k] || {}).passos = Math.round(Math.max(...Object.values(srcs)));
      for (const [k, srcs] of Object.entries(SL)){ const asl = Object.entries(srcs).filter(([x]) => x.endsWith("a")).map(([,v]) => v), bed = Object.entries(srcs).filter(([x]) => x.endsWith("b")).map(([,v]) => v); const mins = asl.length ? Math.max(...asl) : bed.length ? Math.max(...bed) : 0; if (mins > 60 && mins < 1080) (out[k] = out[k] || {}).sono = Math.round(mins); }
      return { dias: out, n }; } };
}
function csvParse(txt){
  const lines = txt.replace(/\r/g, "").split("\n").filter(l => l.trim()); if (lines.length < 2) return { dias:{}, n:0 };
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",", split = l => l.split(sep).map(x => x.trim().replace(/^"|"$/g, ""));
  const H = split(lines[0]).map(h => h.toLowerCase()), find = (...ks) => H.findIndex(h => ks.some(k => h === k || h.startsWith(k)));
  const iD = find("date", "data", "dia"), iW = find("average weight (kg)", "peso", "weight"), iS = find("step count", "passos", "steps"), iSl = find("sono", "sleep");
  if (iD < 0 || (iW < 0 && iS < 0 && iSl < 0)) return null;
  const out = {}; let n = 0;
  for (const l of lines.slice(1)){ const c = split(l); let dt = c[iD]; if (!dt) continue;
    const br = dt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (br) dt = `${br[3]}-${br[2].padStart(2,"0")}-${br[1].padStart(2,"0")}`; dt = dt.slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) continue;
    const num = i => i >= 0 ? parseFloat(String(c[i] || "").replace(",", ".")) : NaN, o = {};
    const w = num(iW), st = num(iS), sl = num(iSl); if (w > 20 && w < 400) o.peso = Math.round(w * 10) / 10; if (st >= 0) o.passos = Math.round(st); if (sl > 0) o.sono = Math.round(sl > 24 ? sl : sl * 60);
    if (Object.keys(o).length){ out[dt] = o; n++; } }
  return { dias: out, n };
}
async function importHealth(file){
  const note = $("#hl-note"), since = Date.now() - 365 * 864e5; note.textContent = "Lendo o arquivo… arquivos do Apple Saúde podem levar um minuto.";
  let res = null, fonte = "";
  try {
    if (/\.zip$/i.test(file.name) || file.type.includes("zip")){
      if (!window.JSZip) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
      const zip = await JSZip.loadAsync(file), names = Object.keys(zip.files);
      const ax = names.find(n => /(^|\/)(export|exportar)\.xml$/i.test(n)) || names.find(n => /\.xml$/i.test(n) && !/cda/i.test(n));
      const gf = names.find(n => /daily activity metrics\.csv$/i.test(n)) || names.find(n => /(métricas de atividades diárias|metricas de atividades diarias)\.csv$/i.test(n));
      if (ax){ fonte = "Apple Saúde"; const P = appleParser(since); await new Promise((ok, no) => zip.file(ax).internalStream("string").on("data", c => P.push(c)).on("error", no).on("end", ok).resume()); res = P.done(); }
      else if (gf){ fonte = "Google Fit"; res = csvParse(await zip.file(gf).async("string")); }
    } else if (/\.xml$/i.test(file.name)){ fonte = "Apple Saúde"; const P = appleParser(since); for await (const c of chunksOf(file)) P.push(c); res = P.done(); }
    else { fonte = /daily activity|atividades/i.test(file.name) ? "Google Fit" : "planilha"; res = csvParse(await file.text()); }
  } catch (e) { note.textContent = "Não consegui ler esse arquivo. Confira se é o arquivo exportado do Apple Saúde ou do Google Fit."; return; }
  if (!res || !Object.keys(res.dias).length){ note.textContent = "Não encontrei peso, passos ou sono do último ano nesse arquivo."; return; }
  let addW = 0;
  for (const [k, v] of Object.entries(res.dias)){
    const { peso, ...rest } = v; if (Object.keys(rest).length) HEALTH.dias[k] = { ...(HEALTH.dias[k] || {}), ...rest };
    if (peso && !(state.measures || []).some(m => m.tipo === "peso" && m.date === k)){ state.measures = [...(state.measures || []), { id:"h" + k.replace(/-/g, ""), tipo:"peso", valor:peso, date:k, fonte }]; addW++; }
  }
  const keys = Object.keys(HEALTH.dias).sort(); if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete HEALTH.dias[k]);
  HEALTH.importado = new Date().toISOString(); HEALTH.fonte = fonte;
  try { await Promise.all([store.set("saude", HEALTH), addW ? store.set("medidas", state.measures) : null]); } catch { note.textContent = "Li o arquivo, mas não consegui salvar agora. Tente de novo."; return; }
  const dS = Object.values(res.dias).filter(v => v.passos != null).length, dSl = Object.values(res.dias).filter(v => v.sono != null).length;
  note.textContent = `Importado (${fonte}): ${addW} ${addW === 1 ? "peso novo" : "pesos novos"}, ${dS} dias de passos e ${dSl} noites de sono.`;
  renderHealth(); renderMeasures(); renderToday();
}
function renderHealth(){
  const out = $("#hl-out"); if (!out) return;
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return [ymd(d), d]; }), D = HEALTH.dias;
  const has = days.some(([k]) => D[k]);
  $("#hl-tag").textContent = HEALTH.importado ? `Atualizado ${new Date(HEALTH.importado).toLocaleDateString("pt-BR", { day:"numeric", month:"short" })}` : "";
  if (!has){ out.innerHTML = HEALTH.importado ? `<p class="note" style="margin:0">Sem dados de passos ou sono nos últimos 14 dias. Exporte de novo para atualizar.</p>` : ""; return; }
  const avg = (f) => { const v = days.slice(-7).map(([k]) => D[k]?.[f]).filter(x => x != null); return v.length ? v.reduce((a,b) => a+b) / v.length : null; };
  const sp = avg("passos"), sl = avg("sono"), hm = m => `${Math.floor(m/60)}h${String(Math.round(m%60)).padStart(2,"0")}`;
  const bars = (f, color, fmt) => { const mx = Math.max(1, ...days.map(([k]) => D[k]?.[f] || 0));
    return `<div class="hl-bars">${days.map(([k, d]) => { const v = D[k]?.[f]; return `<div title="${d.toLocaleDateString("pt-BR")}: ${v != null ? fmt(v) : "sem dado"}"><i style="height:${v ? Math.max(4, v/mx*100) : 0}%;background:${color}"></i><span>${d.toLocaleDateString("pt-BR", { weekday:"narrow" })}</span></div>`; }).join("")}</div>`; };
  out.innerHTML = `<div class="dstats"><div><b>${sp != null ? Math.round(sp).toLocaleString("pt-BR") : "—"}</b><span>Passos por dia (7 dias)</span></div><div><b>${sl != null ? hm(sl) : "—"}</b><span>Sono por noite (7 dias)</span></div></div>
    ${days.some(([k]) => D[k]?.passos != null) ? `<div class="note" style="margin:0">Passos, últimos 14 dias</div>${bars("passos", "var(--accent)", v => v.toLocaleString("pt-BR") + " passos")}` : ""}
    ${days.some(([k]) => D[k]?.sono != null) ? `<div class="note" style="margin:0">Sono, últimos 14 dias</div>${bars("sono", "#6b7fd7", hm)}` : ""}`;
}
$("#hl-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importHealth(f); };
$("#hl-how-btn").onclick = () => { const b = $("#hl-how"); b.hidden = !b.hidden; $("#hl-how-btn").setAttribute("aria-expanded", !b.hidden); };

/* ---------- resumo de hoje (estilo widget) ---------- */
function renderToday(){
  const box = $("#today"); if (!box) return; const P = activePlan(); if (!P) return;
  const nx = nextDayIdx(), sel = state.homeDay != null && state.homeDay < P.dias.length ? state.homeDay : nx, d = P.dias[sel], goal = +normProfile(state.profile).days || 3, done = weekCount(0), ml = +WATER.dias[ymd()] || 0, wg = waterGoal();
  const y = new Date(); y.setDate(y.getDate() - 1); const hy = HEALTH.dias[ymd(y)] || HEALTH.dias[ymd()];
  const trainedToday = state.sessions.some(s => ymd(new Date(s.date)) === ymd());
  box.innerHTML = `<div class="tw-row" role="group" aria-label="Treinos do plano">${P.dias.map((x, i) => i === sel
      ? `<button class="tw-tile on" data-tw="start" aria-current="true"><small>${i !== nx ? "Treino escolhido" : trainedToday ? "Treino de hoje feito ✓" : "Próximo treino"}</small><b>${esc(x.nome || "Treino")}</b><span>${trainedToday && i === nx ? "Toque para treinar de novo" : `${x.exercicios?.length || 0} exercícios · toque para iniciar`}</span></button>`
      : `<button class="tw-tile" data-tday="${i}" aria-label="Escolher ${esc(x.nome)}"><small>${i === nx ? "Próximo" : "Treino"}</small><b>${esc(x.nome)}</b><span>${x.exercicios?.length || 0} exercícios</span></button>`).join("")}</div>
    <button class="tw" data-tw="prog"><small>Sequência</small><b>${streakWeeks()} ${streakWeeks() === 1 ? "semana" : "semanas"} 🔥</b><span>${done} de ${goal} treinos nesta semana</span></button>
    <button class="tw" data-tw="water"><small>Água</small><b>${(ml/1000).toFixed(1).replace(".", ",")} de ${(wg/1000).toFixed(1).replace(".", ",")} L</b><span>Toque para +200 ml</span><i class="tw-bar" style="width:${Math.min(100, ml/wg*100).toFixed(0)}%"></i></button>
    ${hy && (hy.passos != null || hy.sono != null) ? `<button class="tw" data-tw="health"><small>Ontem</small><b>${hy.passos != null ? hy.passos.toLocaleString("pt-BR") + " passos" : ""}</b><span>${hy.sono != null ? `Sono: ${Math.floor(hy.sono/60)}h${String(hy.sono%60).padStart(2,"0")}` : ""}</span></button>` : ""}${(() => { const p = cyclePhase(); return p ? `<button class="tw" data-tw="cy"><small>Ciclo</small><b>Fase ${p.t.toLowerCase()}</b><span>Dia ${p.day} · ${p.f < 1 ? `carga ${Math.round((1 - p.f) * 100)}% menor` : "treino normal"}</span></button>` : ""; })()}`;
  const row = box.querySelector(".tw-row"), on = row?.querySelector(".on"); if (row && on) row.scrollLeft += on.getBoundingClientRect().left - row.getBoundingClientRect().left - (on.previousElementSibling ? 40 : 0);
}
$("#today").onclick = e => { const td = e.target.closest("[data-tday]"); if (td){ state.homeDay = +td.dataset.tday; renderHome(); renderToday(); return; }
  const b = e.target.closest("[data-tw]"); if (!b) return; const k = b.dataset.tw;
  if (k === "start") $("#h-start").click();
  else if (k === "prog"){ prSec("resumo"); tab("progresso"); }
  else if (k === "cy"){ tab("perfil"); setTimeout(() => $("#cy-card").scrollIntoView({ behavior:"smooth" }), 100); }
  else if (k === "health") goCard("#hl-card");
  else { $('#wt-card [data-wt="200"]').click(); renderToday(); } };

/* ---------- modo foco ---------- */
let FOCUS_MEM = false;
const focusOn = () => { try { const v = localStorage.getItem("forja:focus"); return v === null ? FOCUS_MEM : v === "1"; } catch { return FOCUS_MEM; } };
function applyFocus(){ const on = focusOn(); $("#p-treino").classList.toggle("focus", on); $("#pl-focus").setAttribute("aria-pressed", on); }
$("#pl-focus").onclick = () => { const on = !focusOn(); FOCUS_MEM = on; try { localStorage.setItem("forja:focus", on ? "1" : "0"); } catch {} applyFocus(); toast(on ? "Modo foco ligado" : "Modo foco desligado"); };

/* ---------- ciclo menstrual ---------- */
let CICLO = { on:false, inicio:"", dur:28, mens:5, reduzir:true };
function cyclePhase(date = new Date()){
  if (!CICLO.on || !CICLO.inicio) return null;
  const len = Math.min(45, Math.max(21, +CICLO.dur || 28)), mens = Math.min(10, Math.max(2, +CICLO.mens || 5));
  const d0 = new Date(CICLO.inicio + "T00:00"), t = new Date(date); t.setHours(0,0,0,0);
  const diff = Math.round((t - d0) / 864e5); if (diff < 0) return null;
  const day = diff % len + 1, ov = len - 14;
  const P = day <= mens ? { k:"mens", t:"Menstrual", f:.9, txt:"Energia pode estar mais baixa. Carga sugerida 10% menor; priorize técnica e não force recordes." }
    : day < ov - 1 ? { k:"fol", t:"Folicular", f:1, txt:"Boa fase para progredir: a energia e a recuperação costumam estar em alta. Tente subir carga." }
    : day <= ov + 1 ? { k:"ovu", t:"Ovulatória", f:1, txt:"Força costuma estar no pico. Aqueça bem e cuide da técnica nos saltos e mudanças de direção." }
    : day > len - 5 ? { k:"pre", t:"Pré-menstrual", f:.95, txt:"Pode haver retenção e mais cansaço. Carga sugerida 5% menor; mantenha o treino, sem exagerar." }
    : { k:"lut", t:"Lútea", f:1, txt:"Mantenha as cargas. Hidrate bem e capriche no aquecimento." };
  return { ...P, day, len };
}
function renderCycle(){
  if (!$("#cy-card")) return;
  $("#cy-card").hidden = normProfile(state.profile).sex === "masculino" && !CICLO.on;
  $("#cy-on").checked = !!CICLO.on; $("#cy-fields").hidden = !CICLO.on;
  if (document.activeElement?.closest?.("#cy-card") == null){ $("#cy-start").value = CICLO.inicio || ""; $("#cy-dur").value = CICLO.dur || 28; $("#cy-mens").value = CICLO.mens || 5; $("#cy-red").checked = CICLO.reduzir !== false; }
  const p = cyclePhase(); $("#cy-now").innerHTML = p ? `<b>Hoje: fase ${p.t}</b> (dia ${p.day} de ${p.len}). ${p.txt}` : CICLO.on ? "Informe a data do primeiro dia da última menstruação." : "";
}
let cySaveT = null;
$("#cy-card").onchange = () => {
  CICLO = { on: $("#cy-on").checked, inicio: $("#cy-start").value, dur: +$("#cy-dur").value || 28, mens: +$("#cy-mens").value || 5, reduzir: $("#cy-red").checked };
  renderCycle(); renderHome(); renderToday();
  clearTimeout(cySaveT); cySaveT = setTimeout(async () => { try { await store.set("ciclo", CICLO); toast("Ciclo salvo."); } catch { toast("Não consegui salvar agora."); } }, 400);
};

/* ---------- XP e níveis ---------- */
const XP_TITLES = [[1,"Novato"],[3,"Aprendiz"],[5,"Dedicado"],[8,"Guerreiro"],[12,"Atleta"],[17,"Titã"],[23,"Mestre do Ferro"],[30,"Lenda Ironmind"]];
const xpFor = L => 150 * L * (L - 1) / 2 * 2;
function sessXP(s){ return 100 + 2 * s.exercicios.reduce((n,e) => n + e.sets.length, 0) + 50 * (s.prs?.length || 0) + Math.min(60, Math.round((+s.dur || 0) / 2)); }
function xpState(){
  const xp = state.sessions.reduce((a,s) => a + sessXP(s), 0) + Object.keys(achState().earned).length * 100;
  let L = 1; while (xpFor(L + 1) <= xp) L++;
  const title = XP_TITLES.filter(([l]) => L >= l).at(-1)[1];
  return { xp, L, title, cur: xp - xpFor(L), need: xpFor(L + 1) - xpFor(L) };
}
function renderXP(){
  if (!$("#xp-box")) return; const X = xpState();
  $("#xp-lvl").textContent = `Nível ${X.L}`;
  $("#xp-box").innerHTML = `<div class="xp-h"><div class="xp-badge">${X.L}</div><div><b>${X.title}</b><div class="note" style="margin:0">${X.xp.toLocaleString("pt-BR")} XP no total · faltam ${(X.need - X.cur).toLocaleString("pt-BR")} para o nível ${X.L + 1}</div></div></div><div class="ach-bar"><i style="width:${(X.cur / X.need * 100).toFixed(0)}%"></i></div><p class="note" style="margin:0">Cada treino vale 100 XP, mais 2 por série, 50 por recorde e até 60 pela duração. Cada conquista dá 100 XP.</p>`;
}

/* ---------- retrospectiva do ano ---------- */
let rtI = 0, rtSlides = [], rtTimer = null, rtYear = new Date().getFullYear();
function retroData(){
  let y = new Date().getFullYear(); let S = state.sessions.filter(s => new Date(s.date).getFullYear() === y);
  if (S.length < 3 && new Date().getMonth() === 0){ y--; S = state.sessions.filter(s => new Date(s.date).getFullYear() === y); }
  rtYear = y; if (!S.length) return null;
  const mins = S.reduce((a,s) => a + sessDur(s), 0), vol = S.reduce((a,s) => a + sessVol(s), 0), sets = S.reduce((a,s) => a + s.exercicios.reduce((n,e) => n + e.sets.length, 0), 0);
  const cnt = {}; S.forEach(s => s.exercicios.forEach(e => cnt[e.nome] = (cnt[e.nome] || 0) + 1)); const fav = Object.entries(cnt).sort((a,b) => b[1]-a[1])[0];
  const months = Array(12).fill(0); S.forEach(s => months[new Date(s.date).getMonth()]++); const bm = months.indexOf(Math.max(...months));
  const prs = S.flatMap(s => (s.prs || []).map(p => ({ ...p, date:s.date })));
  let top = null; for (const s of S) for (const e of s.exercicios) for (const x of e.sets){ const r = e1rm(x.kg, x.reps); if (!top || r > top.rm) top = { nome:e.nome, rm:r, kg:x.kg, reps:x.reps }; }
  const mus = {}; S.forEach(s => s.exercicios.forEach(e => { const m = infoOf(e).musc; if (MUSC[m]) mus[m] = (mus[m] || 0) + e.sets.length; })); const tm = Object.entries(mus).sort((a,b) => b[1]-a[1])[0];
  const wk = new Set(S.map(s => startOfWeek(Date.parse(s.date)).getTime())); let best = 0, run = 0, last = null; [...wk].sort().forEach(w => { run = last && w - last <= 8*864e5 ? run + 1 : 1; best = Math.max(best, run); last = w; });
  const ach = Object.values(achState().earned).filter(dt => new Date(dt).getFullYear() === y).length;
  return { y, n:S.length, mins, vol, sets, fav, bm, bmN:months[bm], months, prs, top, tm, best, ach, X: xpState() };
}
const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function buildRetro(R){
  const t = v => `${(v/1000).toLocaleString("pt-BR", { maximumFractionDigits:1 })} toneladas`;
  const comp = R.vol >= 2000 ? `É como levantar ${Math.round(R.vol / 1500).toLocaleString("pt-BR")} carros populares.` : "";
  const sl = [
    `<small>Sua retrospectiva</small><h1>${R.y}</h1><p>Um ano de ferro, suor e evolução. Vamos ver seus números?</p>`,
    `<small>Você treinou</small><h1 class="cnt" data-n="${R.n}">${R.n}</h1><p>${R.n === 1 ? "vez" : "vezes"} em ${R.y}, somando <b>${Math.round(R.mins/60)} horas</b> e <b>${R.sets.toLocaleString("pt-BR")} séries</b>.</p>`,
    `<small>Peso total levantado</small><h1>${t(R.vol)}</h1><p>${comp}</p>`,
    R.top && R.top.rm ? `<small>Seu levantamento mais forte</small><h1>${Math.round(R.top.rm)} kg</h1><p>1RM estimado no <b>${esc(R.top.nome)}</b> (${R.top.reps} × ${String(R.top.kg).replace(".", ",")} kg).</p>` : null,
    `<small>Recordes pessoais</small><h1>${R.prs.length}</h1><p>${R.prs.length ? `O último foi em ${esc(R.prs.at(-1).nome)}: ${String(R.prs.at(-1).valor).replace(".", ",")} kg.` : "O próximo ano é a hora de quebrar os primeiros!"}</p>`,
    R.fav ? `<small>Exercício favorito</small><h1 class="sm">${esc(R.fav[0])}</h1><p>Feito em ${R.fav[1]} treinos.${R.tm ? ` O músculo mais treinado foi <b>${MUSC[R.tm[0]]}</b>, com ${R.tm[1]} séries.` : ""}</p>` : null,
    `<small>Seu mês mais forte</small><h1 class="sm">${MES[R.bm]}</h1><div class="rt-months">${R.months.map((v,i) => `<i style="height:${Math.max(4, v / Math.max(1, R.bmN) * 100)}%"${i === R.bm ? ' class="on"' : ""}></i>`).join("")}</div><p>${R.bmN} treinos. Maior sequência: <b>${R.best} ${R.best === 1 ? "semana" : "semanas"}</b> seguidas.</p>`,
    `<small>Você chegou ao</small><h1>Nível ${R.X.L}</h1><p><b>${R.X.title}</b> · ${R.ach} ${R.ach === 1 ? "conquista desbloqueada" : "conquistas desbloqueadas"} em ${R.y}.</p><p>Bora pra ${R.y + 1}! 💪</p>`,
  ].filter(Boolean);
  return sl;
}
function rtShow(i){
  rtI = Math.max(0, Math.min(rtSlides.length - 1, i)); clearTimeout(rtTimer);
  $("#rt-slide").innerHTML = `<div class="rt-in">${rtSlides[rtI]}</div>`;
  $("#rt-bars").innerHTML = rtSlides.map((_, k) => `<span><i class="${k < rtI ? "full" : k === rtI ? "run" : ""}"></i></span>`).join("");
  const last = rtI === rtSlides.length - 1; $("#rt-next").textContent = last ? "Fechar" : "Próximo"; $("#rt-save").hidden = !last; $("#rt-prev").disabled = !rtI;
  if (!last) rtTimer = setTimeout(() => rtShow(rtI + 1), 4500);
}
$("#rt-open").onclick = () => { const R = retroData(); if (!R){ toast("Salve alguns treinos este ano para ver sua retrospectiva."); return; } rtSlides = buildRetro(R); $("#rt").hidden = false; rtShow(0); };
const rtClose = () => { clearTimeout(rtTimer); $("#rt").hidden = true; };
$("#rt-x").onclick = rtClose;
$("#rt-next").onclick = () => rtI === rtSlides.length - 1 ? rtClose() : rtShow(rtI + 1);
$("#rt-prev").onclick = () => rtShow(rtI - 1);
$("#rt-slide").onclick = e => { const r = e.currentTarget.getBoundingClientRect(); rtShow(e.clientX - r.left < r.width / 3 ? rtI - 1 : rtI + 1); };
$("#rt-save").onclick = async () => {
  const R = retroData(); if (!R) return;
  try { await document.fonts.load('800 80px "Barlow Condensed"'); } catch {}
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#ff4d2e"); bg.addColorStop(1, "#7a1f0a"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = "#fff"; g.font = '600 44px Lexend, sans-serif'; g.fillText("ironmind", 80, 120);
  g.font = '800 200px "Barlow Condensed", sans-serif'; g.fillText(String(R.y), 80, 340); g.font = '700 46px "Barlow Condensed", sans-serif'; g.fillStyle = "rgba(255,255,255,.85)"; g.fillText("MINHA RETROSPECTIVA", 80, 410);
  const items = [[String(R.n), "treinos"], [`${Math.round(R.mins/60)} h`, "treinando"], [`${(R.vol/1000).toLocaleString("pt-BR", { maximumFractionDigits:1 })} t`, "levantadas"], [String(R.prs.length), "recordes"], [`${R.best} sem.`, "maior sequência"], [`Nível ${R.X.L}`, R.X.title]];
  items.forEach(([v, l], i) => { const x = 80 + (i % 2) * 470, y = 540 + Math.floor(i / 2) * 210; g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(x, y - 110, 440, 180);
    g.fillStyle = "#fff"; g.font = '800 96px "Barlow Condensed", sans-serif'; g.fillText(v, x + 28, y); g.font = '600 32px Barlow, sans-serif'; g.fillStyle = "rgba(255,255,255,.85)"; g.fillText(l, x + 30, y + 46); });
  if (R.top && R.top.rm){ g.fillStyle = "#fff"; g.font = '600 34px Barlow, sans-serif'; g.fillText(`Mais forte: ${R.top.nome} · 1RM ≈ ${Math.round(R.top.rm)} kg`, 80, 1230); }
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  if (!DOWNLOADS){ toast("Baixar arquivos não está disponível nesta visualização."); return; }
  try { await DOWNLOADS.save({ filename:`ironmind-retrospectiva-${R.y}.png`, data:blob }); toast("Imagem salva. Compartilhe!"); } catch { toast("Download cancelado."); }
};

/* ---------- aviso de troca de treino ---------- */
function planAgeWeeks(P){
  const firstUse = state.sessions.filter(s => s.planoId === P.id).map(s => Date.parse(s.date)).sort((a,b) => a-b)[0];
  const t0 = P.criado ? Date.parse(P.criado) : firstUse; if (!t0) return 0;
  return Math.floor((Date.now() - Math.min(t0, firstUse || t0)) / (7*864e5));
}
function renderSwapWarn(){
  const box = $("#swap-warn"); if (!box) return; const P = activePlan();
  if (!P || P.fonte === "exemplo"){ box.hidden = true; return; }
  const w = planAgeWeeks(P), used = state.sessions.filter(s => s.planoId === P.id).length;
  let snooze = 0; try { snooze = +localStorage.getItem("forja:swapSnooze:" + P.id) || 0; } catch {} snooze = Math.max(snooze, +(P.adiado ? Date.parse(P.adiado) : 0));
  const evo = myEvolution(), stalled = w >= 6 && used >= 8 && evo <= 0.5;
  if ((w < 8 && !stalled) || Date.now() < snooze){ box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<b>${stalled && w < 8 ? "Sua evolução estagnou" : `Seu plano já tem ${w} semanas`}</b><p>${stalled ? `Nas últimas semanas sua força estimada ${evo <= 0 ? "não subiu" : `subiu só ${String(evo).replace(".", ",")}%`}. ` : ""}Trocar exercícios, repetições ou a divisão a cada 6 a 10 semanas ajuda o corpo a continuar se adaptando.</p>
    <div class="row" style="gap:8px"><button class="btn sm primary" data-sw="ai">Gerar novo plano com IA</button><button class="btn sm" data-sw="prog">Ver programas prontos</button><button class="btn sm" data-sw="later">Lembrar em 2 semanas</button></div>`;
}
$("#swap-warn").onclick = async e => { const b = e.target.closest("[data-sw]"); if (!b) return; const P = activePlan();
  if (b.dataset.sw === "ai"){ tab("perfil"); setTimeout(() => ($("#gen") || $("#gen-basic")).scrollIntoView({ behavior:"smooth", block:"center" }), 100); }
  else if (b.dataset.sw === "prog"){ tab("rotinas"); setTimeout(() => $("#pg-card").scrollIntoView({ behavior:"smooth" }), 100); }
  else { P.adiado = new Date(Date.now() + 14*864e5).toISOString(); try { localStorage.setItem("forja:swapSnooze:" + P.id, String(Date.now() + 14*864e5)); } catch {} renderSwapWarn(); try { await savePlans(); } catch {} toast("Combinado, lembro daqui a 2 semanas."); } };

/* ---------- exercícios personalizados ---------- */
let CUSTOM = [];
function applyCustom(){
  for (let i = LIBRARY.length - 1; i >= 0; i--) if (LIBRARY[i].custom){ LIBMAP.delete(LIBRARY[i].nome.toLowerCase()); LIBRARY.splice(i, 1); }
  for (const c of CUSTOM){ if (LIBMAP.has(c.nome.toLowerCase())) continue; const e = { nome:c.nome, musc:c.musc, sec:[], nivel:+c.nivel || 2, equip:c.equip || "corpo", dica:c.dica || "", custom:true, foto:c.foto || "" }; LIBRARY.push(e); LIBMAP.set(e.nome.toLowerCase(), e); }
}
let cxFoto = "";
function renderCustom(){
  if (!$("#cx-card")) return;
  if (!$("#cx-musc").options.length){ $("#cx-musc").innerHTML = [...Object.entries(MUSC), ...Object.entries(EXTRA)].map(([k,t]) => `<option value="${k}">${t}</option>`).join(""); $("#cx-equip").innerHTML = [["corpo","Peso do corpo"], ...Object.entries(EQUIP)].map(([k,t]) => `<option value="${k}">${t}</option>`).join(""); }
  $("#cx-list").innerHTML = CUSTOM.length ? CUSTOM.map(c => `<div class="exrow" style="grid-template-columns:52px minmax(0,1fr) auto">${c.foto ? `<img class="cx-img" src="${c.foto}" alt="Foto de ${esc(c.nome)}">` : `<div class="thumb fig" style="width:52px;height:52px">${figSVG(patternOf({ nome:c.nome, musculo:c.musc }), 1, { label:c.nome })}</div>`}<div class="mid"><b>${esc(c.nome)}</b><span class="rx">${MUSC[c.musc] || EXTRA[c.musc] || ""} · ${esc(EQUIP[c.equip] || "Peso do corpo")}</span></div><button class="mini" data-cx-del="${esc(c.nome)}">Apagar</button></div>`).join("")
    : `<p class="note">Crie exercícios que não estão na biblioteca, como um aparelho específico da sua academia. Eles aparecem na busca e podem entrar nos seus treinos.</p>`;
}
function resizeImg(file, max = 360){ return new Promise((ok, no) => { const img = new Image(), url = URL.createObjectURL(file); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", .78)); }; img.onerror = no; img.src = url; }); }
$("#cx-new").onclick = () => { const f = $("#cx-form"); f.hidden = !f.hidden; $("#cx-new").setAttribute("aria-expanded", !f.hidden); renderCustom(); };
$("#cx-foto").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { cxFoto = await resizeImg(f); $("#cx-prev").src = cxFoto; $("#cx-prev").hidden = false; } catch { toast("Não consegui abrir essa imagem."); } };
$("#cx-save").onclick = async () => {
  const nome = $("#cx-nome").value.trim().replace(/\s+/g, " "); if (nome.length < 3){ toast("Dê um nome ao exercício."); return; }
  if (LIBMAP.has(nome.toLowerCase()) && !CUSTOM.some(c => c.nome.toLowerCase() === nome.toLowerCase())){ toast("Já existe um exercício com esse nome na biblioteca."); return; }
  const c = { nome, musc:$("#cx-musc").value, equip:$("#cx-equip").value, nivel:+$("#cx-nivel").value, dica:$("#cx-dica").value.trim(), foto:cxFoto, criado:new Date().toISOString() };
  CUSTOM = [...CUSTOM.filter(x => x.nome.toLowerCase() !== nome.toLowerCase()), c]; applyCustom();
  try { await store.set("meus_exercicios", CUSTOM); } catch { toast("Não consegui salvar agora."); return; }
  cxFoto = ""; $("#cx-prev").hidden = true; $("#cx-nome").value = ""; $("#cx-dica").value = ""; $("#cx-form").hidden = true; $("#cx-new").setAttribute("aria-expanded", "false");
  renderCustom(); renderLibrary(); toast(`${nome} criado. Ele já aparece na lista de exercícios.`);
};
$("#cx-list").onclick = async e => { const b = e.target.closest("[data-cx-del]"); if (!b) return;
  if (!b.dataset.arm){ b.dataset.arm = "1"; b.textContent = "Confirmar"; setTimeout(() => { if (b.isConnected){ delete b.dataset.arm; b.textContent = "Apagar"; } }, 3000); return; }
  CUSTOM = CUSTOM.filter(c => c.nome !== b.dataset.cxDel); applyCustom(); try { await store.set("meus_exercicios", CUSTOM); } catch {} renderCustom(); renderLibrary(); };

/* ---------- clube da academia ---------- */
let clDocs = [], clUnsub = null, clMetric = "treinosSemana";
const myClub = () => lgRows.find(r => r.id === UID)?.clube || null;
function watchClubs(){ if (!DB || clUnsub) return; try { clUnsub = DB.collection("clubes").onSnapshot(q => { clDocs = q.docs.map(d => ({ id:d.id, ...d.data() })); renderClub(); }, () => {}); } catch {} }
async function setClub(id){
  if (!lgJoin){ lgJoin = true; toast("Você também entrou na Liga Ironmind, onde o clube fica."); }
  CLUB_SEL = id; await publishLeague(); renderLeague(); renderClub();
}
let CLUB_SEL;
async function renderClub(){
  const box = $("#cl-body"); if (!box) return;
  if (!DB){ box.innerHTML = `<p class="note">O clube precisa da sua conta do Claude. Nesta visualização ele não está disponível.</p>`; return; }
  const cid = CLUB_SEL !== undefined ? CLUB_SEL : myClub(), club = clDocs.find(c => c.id === cid);
  if (!cid || !club){
    box.innerHTML = `<p class="note" style="margin:0">Monte um grupo com quem treina na mesma academia e tenha um ranking só de vocês. Crie o clube e passe o código para os amigos, ou entre com o código de alguém.</p>
      <div class="row" style="gap:8px"><input id="cl-name" maxlength="40" placeholder="Nome do clube (ex.: Academia Centro)" style="flex:1;min-width:160px"><button class="btn sm primary" id="cl-create">Criar clube</button></div>
      <div class="row" style="gap:8px"><input id="cl-code" maxlength="6" placeholder="Código" style="flex:1;min-width:120px;text-transform:uppercase"><button class="btn sm" id="cl-join">Entrar</button></div>`;
    return; }
  const mem = lgRows.filter(r => r.clube === cid || (r.id === UID && cid));
  let names = {}; try { names = USERCAP ? await USERCAP.profiles(mem.map(r => r.id)) : {}; } catch {}
  const M = { treinosSemana:["Treinos na semana", r => r.semana === weekKey() ? r.treinosSemana || 0 : 0, String], volumeSemana:["Volume na semana", r => r.semana === weekKey() ? r.volumeSemana || 0 : 0, v => v >= 1000 ? `${(v/1000).toFixed(1).replace(".", ",")} t` : `${v} kg`], evolucao:["Evolução 30 dias", r => r.evolucao || 0, v => `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}%`], xp:["Nível", r => r.xp || 0, v => `${v.toLocaleString("pt-BR")} XP`] };
  const [, get, f] = M[clMetric], rows = mem.map(r => ({ id:r.id, v:get(r) })).sort((a,b) => b.v - a.v);
  box.innerHTML = `<div class="row between" style="flex-wrap:nowrap;gap:8px"><div><b style="font-size:17px">${esc(club.nome)}</b><div class="note" style="margin:0">${rows.length} ${rows.length === 1 ? "membro" : "membros"}${club.id === UID ? " · você é o criador" : ""}</div></div><div class="cl-code" title="Código do clube">${esc(club.codigo)}</div></div>
    <p class="note" style="margin:0">Passe o código <b>${esc(club.codigo)}</b> para os amigos da sua academia. Eles precisam ter o app compartilhado por você.</p>
    <div class="chips" id="cl-metric">${Object.entries(M).map(([k,[t]]) => `<button class="chip" data-clm="${k}" aria-pressed="${k === clMetric}">${t}</button>`).join("")}</div>
    <div class="lg-list">${rows.map((r,i) => `<div class="lg-row${r.id === UID ? " me" : ""}"><span class="lg-pos">${i+1}º</span><span class="lg-name">${esc((names[r.id] && names[r.id].name) || "Atleta")}${r.id === UID ? " (você)" : ""}</span><span class="lg-v">${f(r.v)}</span></div>`).join("")}</div>
    <button class="btn sm" id="cl-leave">Sair do clube</button>`;
}
const genCode = () => Array.from({ length:6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
$("#cl-body").onclick = async e => {
  const t = e.target;
  if (t.closest("[data-clm]")){ clMetric = t.closest("[data-clm]").dataset.clm; renderClub(); return; }
  if (t.closest("#cl-create")){ const nome = $("#cl-name").value.trim(); if (nome.length < 3){ toast("Dê um nome ao clube."); return; }
    let codigo = genCode(); while (clDocs.some(c => c.codigo === codigo)) codigo = genCode();
    try { await DB.doc("clubes/" + UID).set({ nome, codigo, criado:new Date().toISOString() }); clDocs = [...clDocs.filter(c => c.id !== UID), { id:UID, nome, codigo }]; await setClub(UID); toast(`Clube criado. Código: ${codigo}`); } catch { toast("Não consegui criar o clube agora."); } return; }
  if (t.closest("#cl-join")){ const code = $("#cl-code").value.trim().toUpperCase(), c = clDocs.find(x => x.codigo === code); if (!c){ toast("Não achei clube com esse código."); return; } await setClub(c.id); toast(`Você entrou no clube ${c.nome}.`); return; }
  if (t.closest("#cl-leave")){ const b = t.closest("#cl-leave"); if (!b.dataset.arm){ b.dataset.arm = "1"; b.textContent = "Toque de novo para sair"; setTimeout(() => { if (b.isConnected){ delete b.dataset.arm; b.textContent = "Sair do clube"; } }, 3000); return; }
    const was = CLUB_SEL !== undefined ? CLUB_SEL : myClub(); await setClub(null); if (was === UID){ try { await DB.doc("clubes/" + UID).delete(); } catch {} } toast("Você saiu do clube."); }
};

/* ---------- desafio de 30 dias ---------- */
const D30 = [
  { id:"flex", t:"100 flexões por dia", u:"flexões", alvo:d => 100, dica:"Divida ao longo do dia, por exemplo 5 séries de 20. Vale flexão inclinada se precisar." },
  { id:"flexp", t:"Flexões progressivas", u:"flexões", alvo:d => 10 + Math.round(d * 3), dica:"Começa com 13 e chega a 100 no dia 30." },
  { id:"agach", t:"Agachamentos 50 → 200", u:"agachamentos", alvo:d => 45 + Math.round(d * 5.2), dica:"Desça até a coxa ficar paralela ao chão, em várias séries." },
  { id:"prancha", t:"Prancha até 5 minutos", u:"segundos de prancha", alvo:d => 20 + d * 10 - (d % 7 === 0 ? 20 : 0), dica:"Somando várias pranchas no dia. Mantenha o quadril alinhado." },
  { id:"abd", t:"Abdômen de aço", u:"abdominais", alvo:d => 20 + d * 3, dica:"Misture abdominal bicicleta, prancha e elevação de pernas." },
  { id:"passos", t:"10 mil passos por dia", u:"passos", alvo:d => 10000, dica:"Se importar do Apple Saúde ou Google Fit, o app marca sozinho os dias que bateu." },
  { id:"burpee", t:"Burpees 10 → 50", u:"burpees", alvo:d => 8 + Math.round(d * 1.4), dica:"Pode dividir em séries curtas com descanso." },
];
let D30S = null;
const d30Day = () => D30S ? Math.floor((new Date(ymd()) - new Date(D30S.inicio)) / 864e5) + 1 : 0;
function renderD30(){
  const box = $("#d30-card"); if (!box) return;
  if (!D30S){ box.innerHTML = `<details class="d30-more"><summary><h3>Desafio de 30 dias</h3></summary><div class="d30-pick">${D30.map(c => `<button class="d30-opt" data-d30="${c.id}"><b>${esc(c.t)}</b><span>Dia 1: ${c.alvo(1).toLocaleString("pt-BR")} · Dia 30: ${c.alvo(30).toLocaleString("pt-BR")} ${esc(c.u)}</span></button>`).join("")}</div></details>`; return; }
  const C = D30.find(c => c.id === D30S.id) || D30[0], day = Math.min(31, d30Day()), feitos = D30S.feitos || {};
  if (C.id === "passos") for (let i = 1; i <= Math.min(30, day); i++){ const dt = new Date(D30S.inicio + "T12:00"); dt.setDate(dt.getDate() + i - 1); if ((HEALTH.dias[ymd(dt)]?.passos || 0) >= 10000) feitos[i] = true; }
  const n = Object.keys(feitos).filter(k => +k <= 30).length, over = day > 30, todayDone = feitos[day];
  box.innerHTML = `<div class="row between" style="flex-wrap:nowrap;gap:8px"><h3>${esc(C.t)}</h3><span class="tag">${over ? "Encerrado" : `Dia ${day} de 30`}</span></div>
    ${over ? `<p style="margin:0"><b>${n === 30 ? "Desafio completo! 🏆 Você não falhou nenhum dia." : `Você completou ${n} de 30 dias.`}</b></p>` : `<div class="d30-today"><div><small>Meta de hoje</small><b>${C.alvo(day).toLocaleString("pt-BR")} ${esc(C.u)}</b></div><button class="btn ${todayDone ? "" : "primary"} sm" data-d30-done="${day}">${todayDone ? "Feito ✓ (desfazer)" : "Marcar como feito"}</button></div><p class="note" style="margin:0">${esc(C.dica)}</p>`}
    <div class="d30-grid">${Array.from({ length:30 }, (_, i) => `<button class="d30-c${feitos[i+1] ? " on" : ""}${i+1 === day ? " cur" : ""}${i+1 > day ? " fut" : ""}" data-d30-done="${i+1}" ${i+1 > day ? "disabled" : ""} aria-label="Dia ${i+1}${feitos[i+1] ? ", feito" : ""}">${i+1}</button>`).join("")}</div>
    <div class="row between"><span class="note" style="margin:0">${n} de 30 dias feitos</span><button class="mini" id="d30-stop">${over ? "Escolher outro desafio" : "Desistir do desafio"}</button></div>`;
}
async function saveD30(){ try { await store.set("desafio30", D30S); } catch { toast("Não consegui salvar agora."); } }
$("#d30-card").onclick = async e => {
  const pick = e.target.closest("[data-d30]"); if (pick){ D30S = { id:pick.dataset.d30, inicio:ymd(), feitos:{} }; renderD30(); await saveD30(); toast("Desafio começou hoje. Bora!"); return; }
  const dn = e.target.closest("[data-d30-done]"); if (dn){ const k = +dn.dataset.d30Done; if (k > d30Day()) return; D30S.feitos = D30S.feitos || {}; if (D30S.feitos[k]) delete D30S.feitos[k]; else { D30S.feitos[k] = true; tone(1047, .12, .2); tone(1319, .2, .2, .12); if (Object.keys(D30S.feitos).length === 30) toast("Desafio de 30 dias completo! 🏆"); } renderD30(); await saveD30(); return; }
  const st = e.target.closest("#d30-stop"); if (st){ if (d30Day() <= 30 && !st.dataset.arm){ st.dataset.arm = "1"; st.textContent = "Toque de novo para desistir"; setTimeout(() => { if (st.isConnected){ delete st.dataset.arm; st.textContent = "Desistir do desafio"; } }, 3000); return; } D30S = null; renderD30(); await saveD30(); }
};

/* ---------- liga: eventos ---------- */
$("#lg-join").onchange = async e => { lgJoin = e.target.checked;
  if (!DB || !UID){ renderLeague(); return; }
  if (e.target.checked){ await publishLeague(); toast("Você entrou na Liga Ironmind."); }
  else { try { await DB.doc("liga/" + UID).delete(); } catch {} toast("Você saiu da liga."); } };
$("#lg-div").onchange = e => { lgDiv = e.target.value; renderLeague(); };
$("#lg-sub").onchange = e => { lgSub[lgMetric] = e.target.value; renderLeague(); };
$("#lg-metric").onclick = e => { const b = e.target.closest("[data-m]"); if (!b) return; lgMetric = b.dataset.m; renderLeague(); };

/* ---------- seções do progresso ---------- */
let PR_SEC = "resumo"; try { PR_SEC = localStorage.getItem("forja:prsec") || "resumo"; } catch {}
function prSecOf(el){
  const id = el.id, h = el.querySelector("h3")?.textContent || "";
  if (/^(cmp|liga|cl|ch|fd)-card$/.test(id)) return "amigos";
  if (id === "hl-card" || /^Medidas/.test(h)) return "corpo";
  if (id === "mw-card" || /Relatórios|Recordes|Evolução por exercício|Análise da IA/.test(h)) return "evolucao";
  return "resumo";
}
[...$("#p-progresso").children].forEach(el => { if (el.id !== "prsec") el.dataset.sec = prSecOf(el); });
function prSec(sec){
  if (!["resumo","evolucao","corpo","amigos"].includes(sec)) sec = "resumo";
  PR_SEC = sec; try { localStorage.setItem("forja:prsec", sec); } catch {}
  document.querySelectorAll("#prsec [data-ps]").forEach(b => b.setAttribute("aria-selected", b.dataset.ps === sec));
  document.querySelectorAll("#p-progresso [data-sec]").forEach(el => el.hidden = el.dataset.sec !== sec);
}
$("#prsec").onclick = e => { const b = e.target.closest("[data-ps]"); if (!b) return; prSec(b.dataset.ps); window.scrollTo(0, 0); };
function goCard(sel){ const el = $(sel); if (!el) return; tab("progresso"); prSec(el.closest("[data-sec]")?.dataset.sec); setTimeout(() => el.scrollIntoView({ behavior:"smooth" }), 100); }
prSec(PR_SEC);

/* ---------- início ---------- */
(async function start(){
  const ex = basicPlan(DEFAULT_PROFILE); ex.fonte = "exemplo"; ex.nome = "Plano de exemplo"; ex.id = "exemplo";
  state.plans = [ex]; state.activeId = ex.id; fillProfile(DEFAULT_PROFILE); renderAll();
  let s = null;
  try { s = await Promise.race([dbStore(), new Promise(r => setTimeout(()=>r(null), 10000))]); } catch {}
  store = s || localStore();
  $("#sync").textContent = store.kind === "db" ? "Salvo na sua conta" : "Salvo neste aparelho";
  try {
    const [pf, pls, old, ss, ms] = await Promise.all([store.get("perfil"), store.get("planos"), store.get("plano"), store.sessions(), store.get("medidas")]);
    state.measures = Array.isArray(ms) ? ms : [];
    if (pf){ state.profile = pf; fillProfile(pf); }
    if (pls?.lista?.length){ state.plans = pls.lista; state.activeId = pls.ativo; }
    else if (old?.dias?.length){ old.id = old.id || "p1"; old.fonte = old.fonte || "rapido"; state.plans = [old]; state.activeId = old.id; await savePlans(); }
    state.sessions = ss || []; const have = new Set(state.sessions.map(x => x.date)); PENDING.forEach(x => { if (!have.has(x.date)) state.sessions.push(x); }); state.sessions.sort((a,b) => a.date.localeCompare(b.date));
  } catch { $("#sync").textContent = "Sem conexão com seus dados"; }
  renderAll();
  if (!state.profile) tab("perfil");
  try { const [cf, ag, mt, hl, cy, cx, d30] = await Promise.all([store.get("config"), store.get("agua"), store.get("metas"), store.get("saude"), store.get("ciclo"), store.get("meus_exercicios"), store.get("desafio30")]); if (Array.isArray(cx)){ CUSTOM = cx; applyCustom(); } if (d30) D30S = d30; if (hl) HEALTH = { dias:{}, ...hl }; if (cy) CICLO = { ...CICLO, ...cy }; if (cf) CFG = { ...CFG_DEF, ...cf }; if (ag) WATER = { meta:null, dias:{}, log:[], ...ag }; if (Array.isArray(mt)) GOALS_L = mt; } catch {}
  store.endPreload?.();
  renderWater(); renderGoals(); renderHealth(); renderToday(); renderCycle(); renderSwapWarn(); renderHome(); renderD30(); renderCustom(); renderLibrary();
  renderCfg(); showSync(); setTimeout(flushPending, 3000); renderRem(); watchLeague(); watchChallenges(); watchFeed(); watchClubs(); renderLeague(); renderChallenges(); renderFeed(); renderCompare();
  try { DOWNLOADS = window.claude?.use ? await claude.use("downloads") : null; } catch { DOWNLOADS = null; }
  try { sample = window.claude?.use ? await claude.use("sample") : null; } catch { sample = null; }
  $("#coach-fab").hidden = !sample;
  if (!sample){ $("#gen").hidden = true; $("#ai-review").hidden = true; $("#pr-coach-ai").hidden = true;  }
})();
