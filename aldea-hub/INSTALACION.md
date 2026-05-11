# 🚀 Guía de instalación — Aldea Creative Hub
**Sin conocimientos técnicos. Tiempo estimado: 45 minutos.**

---

## PARTE 1 — Crear la base de datos en Firebase (15 min)

### Paso 1: Crear cuenta en Firebase
1. Entrá a **https://firebase.google.com**
2. Clic en **"Comenzar"** (arriba a la derecha)
3. Iniciá sesión con tu cuenta de Google (o creá una)

### Paso 2: Crear tu proyecto
1. Clic en **"Agregar proyecto"**
2. Nombre del proyecto: `aldea-creative-hub`
3. Desactivá "Google Analytics" (no es necesario) → clic en **"Crear proyecto"**
4. Esperá que termine → clic en **"Continuar"**

### Paso 3: Crear la base de datos Firestore
1. En el menú de la izquierda, buscá **"Firestore Database"**
2. Clic en **"Crear base de datos"**
3. Elegí **"Comenzar en modo de prueba"** → clic en **"Siguiente"**
4. Elegí la región **"us-east1"** (o la más cercana) → clic en **"Listo"**

### Paso 4: Configurar permisos (IMPORTANTE)
1. En Firestore, clic en la pestaña **"Reglas"**
2. Reemplazá todo el texto con esto:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
3. Clic en **"Publicar"**

### Paso 5: Obtener las credenciales
1. En el menú lateral, clic en el ícono de ⚙️ (rueda dentada) → **"Configuración del proyecto"**
2. Bajá hasta la sección **"Tus apps"**
3. Clic en el ícono **`</>`** (web)
4. Nombre de la app: `aldea-hub` → clic en **"Registrar app"**
5. Vas a ver un bloque de código con `firebaseConfig`. **Copialo completo** — lo necesitás en el Paso 7.

---

## PARTE 2 — Subir el código a GitHub (10 min)

### Paso 6: Crear cuenta en GitHub
1. Entrá a **https://github.com**
2. Clic en **"Sign up"** y creá tu cuenta gratuita

### Paso 7: Subir los archivos
1. Una vez logueado, clic en **"+"** (arriba a la derecha) → **"New repository"**
2. Nombre: `aldea-creative-hub`
3. Seleccioná **"Private"** (importante, para que sea solo tuyo)
4. Clic en **"Create repository"**
5. En la pantalla siguiente, clic en **"uploading an existing file"**
6. Vas a tener que subir los archivos respetando esta estructura:

```
aldea-hub/
├── package.json
├── public/
│   └── index.html
└── src/
    ├── index.js
    ├── firebase.js   ← ACÁ tenés que pegar TU config de Firebase
    └── App.js
```

### Paso 8: Configurar Firebase en el código
Antes de subir, abrí el archivo `src/firebase.js` con el Bloc de notas y reemplazá los valores "REEMPLAZAR" con los que copiaste en el Paso 5:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",        // ← tu valor
  authDomain:        "aldea-xxx.firebaseapp.com",
  projectId:         "aldea-creative-hub",
  storageBucket:     "aldea-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc123",
};
```

Guardá el archivo y subilo junto con los demás.

---

## PARTE 3 — Publicar en Vercel (10 min)

### Paso 9: Crear cuenta en Vercel
1. Entrá a **https://vercel.com**
2. Clic en **"Sign Up"** → elegí **"Continue with GitHub"**
3. Autorizá el acceso

### Paso 10: Publicar la app
1. En el dashboard de Vercel, clic en **"Add New Project"**
2. Vas a ver tu repositorio `aldea-creative-hub` → clic en **"Import"**
3. En la configuración:
   - **Framework Preset**: Create React App (lo detecta automáticamente)
   - Todo lo demás lo dejás como está
4. Clic en **"Deploy"**
5. Esperá 2-3 minutos mientras se construye

### Paso 11: Tu app está online 🎉
Vercel te da una URL del tipo:
**`https://aldea-creative-hub-xxxx.vercel.app`**

¡Esa es tu app! Podés compartirla con tu equipo.

---

## PARTE 4 — Primer uso

### Paso 12: Registrarte como director
1. Abrí la URL de tu app
2. Clic en **"Registrarse"**
3. Ingresá tu nombre, elegí **"Director / Dueño"**
4. Pegá tu API key de Anthropic (`sk-ant-...`)
5. Elegí una contraseña
6. Clic en **"Crear cuenta →"**

### Paso 13: Invitar a tu equipo
Compartiles la URL de la app y deciles que:
1. Hagan clic en "Registrarse"
2. Elijan su rol
3. Pongan su propia API key de Anthropic
4. Elijan su contraseña

Vos los vas a ver aparecer en el **Panel del Equipo** (tab 👥).

---

## ¿Qué se guarda en Firebase?

| Colección       | Qué contiene                              |
|-----------------|-------------------------------------------|
| `users`         | Nombre, rol y fecha de cada miembro       |
| `activity`      | Log de todas las acciones del equipo      |
| `conversations` | Historial guardado de chats y campañas    |

---

## Preguntas frecuentes

**¿Es gratis?**
Sí. Firebase tiene un plan gratuito (Spark) que soporta hasta 50.000 lecturas y 20.000 escrituras por día — más que suficiente para una agencia pequeña. Vercel también es gratis.

**¿Qué pasa si alguien cierra el navegador?**
Puede volver a entrar con su nombre y contraseña. Todo el historial guardado sigue en Firebase.

**¿Puedo cambiarle el nombre o los colores a la app?**
Sí, cualquier cambio que hagas en los archivos y los vuelvas a subir a GitHub se publica automáticamente en Vercel.

**¿Mis datos son seguros?**
Las conversaciones y actividad se guardan en Firebase. La API key de Anthropic se guarda localmente en el navegador de cada usuario (no va a Firebase).

---

## Soporte
Si algo no funciona, volvé a la conversación en Claude y describí el error exacto que ves. Lo resolvemos.
