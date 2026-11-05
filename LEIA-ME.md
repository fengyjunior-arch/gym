# Ironmind como aplicativo

Este pacote é o Ironmind fora do claude.ai, sem inteligência artificial. Depois de publicado, ele:

- instala no celular com ícone próprio (Android e iPhone) e abre em tela cheia;
- abre mesmo sem internet, com os últimos dados que você viu;
- tem login por e-mail, com um link de acesso e sem senha;
- guarda treinos, Liga, desafios, feed e clube no seu banco do Supabase.

Você precisa de duas contas grátis, Supabase e Netlify, e não tem nenhum custo. Leva uns 15 minutos.

---

## 1. Supabase (banco de dados e login)

1. Crie uma conta em supabase.com e clique em **New project**. Escolha um nome, como `ironmind`, uma senha do banco e a região São Paulo.
2. Quando o projeto terminar de criar, abra **SQL Editor > New query**, cole todo o conteúdo do arquivo `supabase.sql` e clique em **Run**.
3. Abra **Project Settings > API** e copie dois valores:
   - **Project URL** (algo como `https://abcd.supabase.co`)
   - **anon public key**
4. Abra o arquivo `public/config.js` num editor de texto (Bloco de Notas serve) e cole os dois valores nos lugares indicados.

## 2. Netlify (onde o app fica no ar)

1. Crie uma conta em netlify.com e abra **app.netlify.com/drop**.
2. Arraste a pasta **`public`** inteira para a página. Em poucos segundos o app está no ar.
3. Copie o endereço do site, algo como `https://ironmind-junior.netlify.app`. Em **Site configuration > Change site name** dá para trocar o nome.

## 3. Ligar o login ao endereço do app

No Supabase, abra **Authentication > URL Configuration**:

- **Site URL**: o endereço da Netlify completo, começando com `https://` e sem barra no fim (ex.: `https://ironmind-junior.netlify.app`)
- **Redirect URLs**: o mesmo endereço com `/**` no fim (ex.: `https://ironmind-junior.netlify.app/**`)

Sem isso, o link do e-mail não volta para o app.

## 4. Instalar no celular

Abra o endereço no celular, entre com seu e-mail e toque no link que chegar.

- **Android (Chrome):** use o botão **Instalar agora** no Perfil, ou toque em ⋮ e escolha **Instalar app**.
- **iPhone (Safari):** toque em **Compartilhar** e escolha **Adicionar à Tela de Início**.

## 5. Trazer seus dados do claude.ai

1. No Ironmind do claude.ai, vá em **Perfil > Backup dos seus dados** e toque em **Exportar backup**.
2. No app novo, depois de entrar, vá em **Perfil > Backup dos seus dados**, toque em **Importar backup** e escolha o arquivo.

Seus amigos também precisam entrar no app novo para aparecer na Liga.

---

## Atualizar o app depois

Quando eu mandar uma versão nova, abra o site na Netlify, vá em **Deploys** e arraste a nova pasta `public` para a área de envio. Antes, copie o seu `config.js` para dentro dela. O celular pega a versão nova na próxima vez que abrir com internet.

## Limites que é bom saber

- O plano grátis do Supabase envia poucos e-mails de login por hora. Para uso pessoal e com amigos, é suficiente.
- Sem internet dá para abrir o app, ver tudo e registrar treinos, que são enviados quando a conexão voltar. Salvar outras mudanças precisa de internet.
- Lembretes continuam sendo arquivos de calendário, como antes, porque o app ainda não envia notificações push.
