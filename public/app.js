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
const SITE_SET = new Set(SITE_LIB.map(e => e[0].toLowerCase()));
const LIBRARY = [
  ...SITE_LIB.map(([nome,cats,musc,sec,nivel,equip,dica]) => ({nome,cats,musc,sec,nivel,equip,dica})),
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
  $("#how-steps").innerHTML = (ex.custom ? [ex.dica || "Exercício criado por você."] : steps.slice(0,3)).map(s => `<li>${esc(s)}</li>`).join("");
  $("#how-err").textContent = steps[3] || "";
  $("#how-tip").hidden = !tip; $("#how-tip").innerHTML = `<b>Dica</b>${esc(tip||"")}`;
  $("#how").hidden = false; document.body.style.overflow = "hidden";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, per = POSES[key]?.slow ? 4200 : 2600, t0 = performance.now();
  cancelAnimationFrame(howRAF);
  const frame = now => {
    const c = ((now - t0) % per) / per; let t;
    if (reduce) t = c < .5 ? 0 : 1;
    else t = c < .15 ? 0 : c < .5 ? (c-.15)/.35 : c < .65 ? 1 : 1 - (c-.65)/.35;
    const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    $("#how-fig").innerHTML = figSVG(key, e, { label: "Animação: " + (ex.nome||name) });
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
  const pool = m => { const all = LIBRARY.filter(e => e.musc === m && hasEquip(e.equip, p.equip) && !/encolhimento|depress[aã]o|suspens[aã]o|punho/i.test(e.nome));
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
function thumb(info, ex){
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
function renderLibrary(){
  const P = activePlan(), pf = normProfile(state.profile), q = $("#l-q").value.trim().toLowerCase(), mine = $("#l-mine").checked, m = state.libMusc;
  $("#l-musc").innerHTML = [["todos","Todos"], ...Object.entries(CATS)].map(([k,t]) => `<button class="chip" data-m="${k}" aria-pressed="${k===m}">${t}</button>`).join("");
  const cur = $("#l-day").value; $("#l-day").innerHTML = P.dias.map((d,i) => `<option value="${i}">${esc(d.nome)}</option>`).join(""); if (cur && +cur < P.dias.length) $("#l-day").value = cur;
  const list = LIBRARY.map((e,i) => [e,i]).filter(([e]) => !e.hidden && (m === "todos" || catsOf(e).includes(m)) && (!mine || hasEquip(e.equip, pf.equip)) && (!q || e.nome.toLowerCase().includes(q)));
  const { pct } = recovery();
  $("#l-list").innerHTML = list.length ? list.map(([e,i]) => exRow(e, pct, { lib:true, key:i })).join("") : `<p class="note">Nenhum exercício encontrado. Tente outro filtro ou desmarque “Só com meu equipamento”.</p>`;
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

Regras: exatamente ${p.days} dias de treino; cabe em ${p.min} minutos incluindo aquecimento e descanso; combine os objetivos de forma equilibrada; use só o equipamento disponível; evite exercícios que agravem as limitações; adapte volume à idade e experiência; para cardio ou mobilidade use reps em tempo (ex.: "20 min"); prefira nomes desta lista quando servirem: ${libVis().map(e => e.nome).join("; ")}; dica curta de execução por exercício (máx. 12 palavras).
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
