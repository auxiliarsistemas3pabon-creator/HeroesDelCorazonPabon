# Héroes del Corazón

Aplicación web para gestionar evaluaciones internas: formularios configurables, carga inicial de personal y evaluaciones, diligenciamiento por colaboradores y consulta de resultados por responsables de área.

Este documento describe la solución para desarrollo y mantenimiento. Los requisitos funcionales e historias de usuario se mantienen en el documento Word del proyecto.

## Componentes

| Directorio | Tecnología | Responsabilidad |
| --- | --- | --- |
| `frontend/` | React, Vite, Tailwind CSS | Interfaz de usuario y sesión web. |
| `backend/` | Django 5, Django REST Framework | API, autenticación, reglas del dominio y administración. |
| `backend/users/` | Aplicación Django | Usuarios, roles y carga de personal. |
| `backend/questions/` | Aplicación Django | Evaluaciones, categorías, preguntas, respuestas y reportes. |
| PostgreSQL | PostgreSQL 16 | Persistencia local y de producción. En Docker Compose usa el volumen `heroes_api_postgres_data`. |
| SQL Server | SQL Server local | Destino previsto para una migración posterior. |

En desarrollo, Vite sirve el frontend en `http://localhost:5173/admin/` y reenvía `/api` al backend. La API local se publica en `http://localhost:8001` (o el puerto indicado por `API_PORT`).

## Requisitos previos

- Docker Desktop con Docker Compose v2.
- Node.js y npm compatibles con la versión de Vite del proyecto.
- Git para obtener el código y mantener cambios.

El backend corre dentro de Docker en el flujo recomendado; no es necesario instalar Python en el equipo para iniciarlo. El desarrollo y el Compose de producción usan PostgreSQL persistente, HTTPS y un servicio SMTP.

## Inicio en desarrollo

1. Configurar `backend/.env` con las variables de backend descritas en la sección [Configuración](#configuración). Este archivo local no se versiona; los valores actuales son solo para desarrollo y no se deben usar en producción.
2. Iniciar API, PostgreSQL y Mailpit:

   ```powershell
   cd backend
   docker compose up --build
   ```

   Django aplica migraciones a PostgreSQL al arrancar el contenedor. Mailpit permite revisar mensajes de correo localmente en `http://localhost:8026`.

3. En otra terminal, iniciar el frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

4. Abrir `http://localhost:5173/admin/login`: la app vive bajo `/admin/` y cualquier otra ruta responde "Acceso no autorizado.". La administración Django está en `http://localhost:8001/django-admin/`.

Si los puertos están ocupados, establecer `API_PORT` y/o `MAILPIT_UI_PORT` en `backend/.env`. En desarrollo, `VITE_API_URL=http://localhost:8001` apunta al puerto local que Docker publica para Django. En producción, el cliente usa `/api/v1` en el mismo origen y Render reenvía esa ruta al backend.

Para crear una cuenta administrativa local:

```powershell
docker compose exec backend python manage.py createsuperuser
```

## Configuración

Docker Compose lee `backend/.env` y Vite lee `frontend/.env` automáticamente. Ambos archivos son locales y están excluidos de Git; cada entorno debe aprovisionarlos por separado. El desarrollo local requiere `DJANGO_SECRET_KEY`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `CHANNELS_REDIS_URL`, `FRONTEND_BASE_URL`, `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS`. Para correo, configurar `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` y `DEFAULT_FROM_EMAIL`; en desarrollo con Mailpit, las credenciales SMTP pueden quedar vacías. Los puertos locales opcionales son `API_PORT`, `DB_PORT` y `MAILPIT_UI_PORT`. En desarrollo, `VITE_API_URL` apunta al backend local de Docker; el build de producción no requiere esa variable porque usa el proxy de mismo origen de Render. Las variables `VITE_*` se incorporan al código enviado al navegador y nunca deben contener credenciales ni secretos.

Variables importantes del backend:

- `DJANGO_SETTINGS_MODULE`: `config.settings.dev` en desarrollo y `config.settings.prod` en producción.
- `DJANGO_SECRET_KEY`: clave secreta de Django; usar una clave privada fuerte en cada ambiente.
- `DJANGO_ALLOWED_HOSTS`: hosts válidos para Django.
- `DATABASE_ENGINE`: motor Django. El valor predeterminado es `postgresql`; SQL Server se selecciona explícitamente.
- `SQLSERVER_DB`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`, `SQLSERVER_HOST`, `SQLSERVER_PORT`, `SQLSERVER_DRIVER`: conexión a SQL Server cuando se selecciona ese motor.
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: conexión de origen, solo necesaria para la transferencia inicial desde el volumen PostgreSQL existente.
- `FRONTEND_BASE_URL`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`: origen del sitio y política del navegador.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`: salida de correos. Desarrollo usa Mailpit.
- `AUTH_COOKIE_SAMESITE` y `AUTH_COOKIE_SECURE`: configuración de cookies; producción fuerza cookies seguras.
- `DEFAULT_USER_PASSWORD`: contraseña inicial de las cuentas nuevas (por defecto `Pabon2026*`); siempre con cambio obligatorio.
- `UPLOAD_MAX_MB`: tamaño máximo de los archivos de carga (por defecto 5).
- `AXES_FAILURE_LIMIT`, `AXES_COOLOFF_TIME_HOURS`, `THROTTLE_RATE_*`, `JWT_ACCESS_TOKEN_LIFETIME_MINUTES`, `JWT_REFRESH_TOKEN_LIFETIME_DAYS`: límites de seguridad (ver [Seguridad](#seguridad-25-capas)).

Variable del frontend: `VITE_IDLE_TIMEOUT_MINUTES` (por defecto 15), minutos sin actividad antes de cerrar la sesión.

No versionar archivos `.env`, claves, credenciales, copias de bases de datos ni archivos de importación con datos reales. Antes de compartir datos de ejemplo, comprobar que sean sintéticos.

## Despliegue del frontend en Render

El archivo `render.yaml` define el frontend como Static Site en el mismo repositorio. Render ejecuta `npm ci` y el build de Vite, publica `dist/` desde `frontend/`, reenvía `/api/*` al backend existente y sirve `index.html` para las rutas de React Router. Este proxy de mismo origen permite que el navegador guarde y envíe las cookies httpOnly sin depender de cookies de terceros. Las reglas de proxy de Vercel se retiraron; sus archivos conservan únicamente el fallback SPA.

Para crear el sitio, sincroniza el Blueprint `render.yaml` desde el Dashboard de Render y despliega o sincroniza el servicio `HeroesDelCorazon-pabon-1`. Después copia el origen HTTPS asignado al sitio en `FRONTEND_BASE_URL` del servicio backend y verifica que `CSRF_TRUSTED_ORIGINS` incluya ese mismo origen. Render debe volver a desplegar el backend tras guardar esos valores. No reemplaces `DATABASE_URL` ni las variables de autenticación del backend. En producción, `AUTH_COOKIE_SAMESITE` usa `Lax` por defecto; si Render tiene configurado explícitamente `None`, cámbialo a `Lax` para el proxy de mismo origen.

Local mantiene el backend Docker: `frontend/.env` usa `VITE_API_URL=http://localhost:8001` como destino del proxy de Vite. El navegador llama a `/api` en `localhost:5173`, y Vite reenvía la solicitud al contenedor; así las cookies quedan en el mismo origen local.

## Estructura del backend

- `backend/config/settings/base.py`: configuración común, selección de PostgreSQL o SQL Server, DRF, JWT, seguridad y zona horaria `America/Bogota`.
- `backend/config/settings/dev.py` y `prod.py`: ajustes por ambiente.
- `backend/config/urls.py`: prefijo `/api/v1/` y administración Django.
- `backend/users/`: usuarios, autenticación, roles, cambio de contraseña, revocación de sesiones y carga de personal; ver [Módulo users](#modulo-users).
- `backend/questions/models.py`: `Evaluation` es un formulario; cada formulario contiene `Category` y `Criterion`. `Question` guarda las calificaciones asociadas a colaborador, persona evaluada y formulario.
- `backend/common/`: autenticación JWT, validación CSRF, permisos reutilizables, middlewares de seguridad, validación de archivos y paginación; ver [Módulo common](#modulo-common).
- `backend/audit/`: auditoría en log JSON y en la tabla de solo inserción `AuditEvent`. `backend/realtime/`: notificaciones WebSocket (sin modelos).
- `backend/*/migrations/`: historial versionado del esquema. Cambios a modelos deben ir acompañados de migraciones.

La API está montada bajo `/api/v1/`. Entre las rutas principales están:

| Ruta | Uso |
| --- | --- |
| `/auth/login/`, `/auth/logout/`, `/auth/me/`, `/auth/refresh/` | Sesión y perfil autenticado. |
| `/auth/password-change/` | Cambio de la propia contraseña (obligatorio con la contraseña inicial). |
| `/users/import/`, `/users/collaborators/`, `/users/areas/` | Carga y consulta de personal. |
| `/questions/import/`, `/questions/answers/import/` | Carga de formularios o respuestas. |
| `/questions/evaluations/`, `/questions/categories/`, `/questions/form/` | Formularios y configuración de preguntas. |
| `/questions/`, `/questions/sent/`, `/questions/submissions/`, `/questions/quota/` | Diligenciamiento, seguimiento y cupos. |
| `/questions/results/`, `/questions/results-summary/`, `/questions/category-averages/`, `/questions/dashboard/`, `/questions/stats/` | Consulta de resultados e indicadores. |

El detalle de métodos, permisos y formatos de respuesta está en las vistas, serializadores y rutas de `backend/users/` y `backend/questions/`. La especificación OpenAPI se configura con `drf-spectacular`.

## Módulo users

El módulo Django `backend/users/` gestiona las cuentas, el inicio y cierre de sesión, el perfil autenticado, los permisos basados en roles, el cambio de contraseña (con revocación de sesiones) y las importaciones de personal. Sus rutas se registran en `users/urls.py` bajo el prefijo `/api/v1/`.

### Modelo y roles

El modelo `User` extiende el usuario de Django. `username` identifica la cuenta y normalmente contiene el número de documento; `email` es opcional, único y limitado al dominio institucional `demo.com`. Los campos adicionales incluyen nombres, apellidos, área, cargo (`position`) y `password_change_required`.

| Rol | Etiqueta en la app | Responsabilidad |
| --- | --- | --- |
| `superadmin` | Superadministrador | Administración global, usuarios y carga de personal. No participa en evaluaciones. |
| `boss` | Coordinador | Crea, programa y consulta evaluaciones. Además participa como colaborador: evalúa, se autoevalúa y lo evalúan los de su área. |
| `collaborator` | Colaborador | Evalúa a personas de su área, se autoevalúa y es evaluado. |

`User.PARTICIPANT_ROLES = (boss, collaborator)` define quién evalúa y es evaluado; las vistas y filtros usan esa constante en lugar de listas de roles. El antiguo rol `personal` (persona evaluada sin acceso) se eliminó: la migración `users/0016_merge_personal_into_collaborator` convierte esas cuentas en colaboradores (irreversible en los datos).

El registro público está deshabilitado: solo un superadmin puede crear cuentas desde la API. El rol no se puede asignar desde la solicitud de registro ni editarse desde el serializador de usuario; se asigna después con `PATCH /users/admin/<id>/`. Las comprobaciones de permisos de API también se aplican en el backend; ocultar opciones en la interfaz no sustituye esos controles.

### Rutas de la API

Todas las rutas siguientes se anteponen con `/api/v1/`.

| Ruta | Acceso y propósito |
| --- | --- |
| `POST /auth/login/` | Público. Autentica con `username` y contraseña; establece cookies de sesión. |
| `POST /auth/refresh/`, `POST /auth/logout/` | Renovación y cierre de sesión. |
| `GET /auth/me/` | Devuelve el perfil de la sesión actual. |
| `POST /auth/password-change/` | Usuario autenticado. Exige `current_password`; la nueva no puede ser la actual ni la contraseña inicial. Revoca las sesiones de los demás equipos y emite cookies nuevas para el actual. |
| `POST /users/register/` | Solo superadmin. Crea un colaborador; `password` es opcional (sin ella se usa `DEFAULT_USER_PASSWORD`). La cuenta queda con `password_change_required=True`. |
| `GET`, `PATCH /users/admin/`, `/users/admin/<id>/` | Solo superadmin. Lista cuentas; cambia rol, inhabilita o restablece contraseña (revoca todas las sesiones de la cuenta; restablecer a la contraseña inicial obliga a cambiarla). |
| `GET /users/areas/` | Público. Lista áreas activas para sugerir durante el registro. |
| `GET /users/collaborators/` | Usuario autenticado. Lista participantes activos (colaboradores y coordinadores) de su misma área. |
| `GET /users/staff-candidates/`, `GET /users/evaluators/` | Coordinador o superadmin; lista participantes evaluables y evaluadores activos. |
| `POST /users/import/` | Solo superadmin. Importa personal desde un archivo Excel `.xlsx` validado (ver capa 24). |

Las sesiones usan cookies `httpOnly`; las cookies de autenticación y CSRF se configuran en `common` y en los ajustes de Django. Las contraseñas se validan con los validadores de Django. Pruebas: `users/tests.py`, `users/test_password_change.py`, `users/test_security.py` y `users/test_security_layers.py`.

### Importación y creación de cuentas

`users/staff_import.py` lee Excel `.xlsx` y reconoce encabezados en español o equivalentes, ignorando diferencias de mayúsculas, tildes y separadores. Documento, nombres, área y cargo son obligatorios; apellidos y **Rol** son opcionales. Rol acepta `Colaborador` o `Coordinador` (también `Jefe`); vacío = colaborador. Los superadministradores no se cargan desde Excel (se crean uno a uno en Usuarios) y un rol desconocido se reporta como error de fila. Los documentos ya registrados se omiten, no se actualizan (ni su rol ni su clave).

**Contraseña inicial.** Toda cuenta nueva (carga de personal o "Crear usuario") recibe `DEFAULT_USER_PASSWORD` (por defecto `Pabon2026*`, configurable por variable de entorno) y `password_change_required=True`. Como esa contraseña la conoce todo el mundo, `common.authentication.enforce_password_change` bloquea con 403 (`password_change_required`) toda la API salvo `me`, `password-change`, `logout` y `csrf` hasta que la persona elige una propia; el frontend muestra solo la pantalla "Cambia tu contraseña". El valor nunca se incluye en el frontend. La plantilla de carga se descarga desde la pantalla; su hoja de datos va vacía y los ejemplos van en una hoja "Instrucciones" que no se lee.

Para crear un colaborador manualmente, un superadmin puede usar "Usuarios > Crear usuario", la API protegida o `users/management/commands/create_collaborator.py`, que solicita la contraseña de forma interactiva:

```powershell
docker compose exec backend python manage.py create_collaborator <documento> <nombres>
```

Los superusuarios se crean con el comando estándar de Django `createsuperuser`. No usar contraseñas de ejemplo ni credenciales temporales en producción.

## Módulo questions

La aplicación `backend/questions/` administra los formularios de evaluación, su programación, las respuestas y los reportes. Las rutas se registran en `questions/urls.py` bajo `/api/v1/`; los modelos y reglas de negocio están en `models.py`, `config_views.py`, `views.py`, `serializers.py` y `limits.py`.

### Modelo y ciclo de evaluación

| Entidad | Responsabilidad |
| --- | --- |
| `Evaluation` | Formulario independiente, tipo de escala, áreas y personas incluidas, evaluadores autorizados, límite mensual, selección aleatoria, disponibilidad y fecha de cierre. |
| `Category` | Agrupa criterios dentro de una evaluación. Su código identifica las respuestas históricas. |
| `Criterion` | Pregunta o criterio puntuable de una categoría. Los códigos de categoría y criterio deben ser únicos. |
| `Question` | Una calificación para un criterio, asociada al formulario, al colaborador que responde y a la persona evaluada. Una entrega completa crea una fila por criterio. |
| `EvaluationSetting` | Límite mensual global utilizado cuando un formulario no tiene un límite propio. |

El ciclo habitual es: crear un formulario con sus categorías y criterios; programarlo como una evaluación independiente; seleccionar fecha de cierre, áreas, personal y evaluadores; los colaboradores responden el formulario disponible; finalmente, los responsables consultan entregas y resultados. Programar un formulario crea una copia independiente, sin copiar respuestas. Un formulario recién creado no aparece a los colaboradores hasta quedar programado.

Los coordinadores (`boss`) administran los formularios que crearon y consultan los resultados permitidos para su área. Los superadministradores (`superadmin`) pueden administrar formularios globalmente y no participan en evaluaciones. Colaboradores y coordinadores (`PARTICIPANT_ROLES`) responden evaluaciones abiertas que les correspondan, a personas activas de su misma área, y son evaluados por ellas. Cuando el coordinador entra a "Evaluar" o "Autoevaluación", el frontend envía `?participant=1` y el backend le da exactamente la vista de colaborador (`common.permissions.acts_as_manager`). Una programación sin evaluadores elegidos espera evaluaciones de todos los participantes del área.

Hay dos tipos de programación (`Evaluation.kind`): **grupal** (`group`, cada participante evalúa a otros de su área) e **individual** (`self`, autoevaluación). En Resultados, el filtro "Tipo de programación" (por defecto grupal) separa ambos; en escalas cualitativas cada promedio se muestra con su resultado (p. ej. 2.8 → "Bueno"), redondeado al nivel más cercano de la escala.

La calificación depende de `rating_type`: las escalas cuantitativas y descriptivas habituales van de 1 a 5, `quantitative_10` va de 1 a 10, y cumplimiento descriptivo usa 0 a 3. En esta última, 0 significa “no aplica” y se excluye de los promedios. Cada envío debe incluir exactamente una respuesta para cada criterio activo de la evaluación. El límite mensual aplica por evaluación y colaborador; reprogramar una evaluación inicia una nueva ronda. Para selección aleatoria, el sistema asigna una lista estable durante el periodo.

Las respuestas se conservan como historial: una evaluación con respuestas no se elimina y no se pueden añadir criterios a un formulario ya respondido. Las categorías o criterios con respuestas se desactivan en vez de eliminarse; el formulario histórico puede incluir inactivos para mostrar resultados previos. La fecha de cierre se compara con el día local (`America/Bogota`) y la evaluación sigue abierta durante todo ese día.

### Rutas de la API

Todas las rutas de la tabla se anteponen con `/api/v1/`. Las acciones de configuración y reportes administrativos requieren `boss` o `superadmin`; cuando un jefe modifica un objeto, solo puede hacerlo si lo creó.

| Método y ruta | Acceso y propósito |
| --- | --- |
| `GET /questions/evaluations/` | Usuario autenticado. Lista formularios del jefe o evaluaciones disponibles para el colaborador. `?mine=1` limita la consulta administrativa a formularios con respuestas; `?participant=1` da al coordinador la vista de colaborador. |
| `POST /questions/evaluations/` | Jefe o superadmin. Crea un formulario independiente, opcionalmente con categorías y criterios. |
| `PATCH`, `DELETE /questions/evaluations/<id>/` | Jefe o superadmin propietario. Actualiza datos/programación o elimina solo si aún no hay respuestas; si hay historial, debe cerrarse. |
| `POST /questions/evaluations/<id>/programs/` | Jefe o superadmin propietario. Programa una copia independiente con `closes_on`, `areas`, `personal_ids`, `evaluator_ids`, `monthly_limit` y `random_selection`. |
| `GET`, `POST /questions/categories/` | Jefe o superadmin. Consulta categorías de `?evaluation=<id>` o crea categoría con criterios. |
| `PATCH`, `DELETE /questions/categories/<id>/` | Jefe o superadmin propietario. Edita, desactiva o elimina una categoría sin respuestas. |
| `POST /questions/categories/<id>/criteria/` | Jefe o superadmin propietario. Añade un criterio a la categoría si la evaluación aún no tiene respuestas. |
| `PATCH`, `DELETE /questions/criteria/<id>/` | Jefe o superadmin propietario. Edita, desactiva o elimina un criterio sin respuestas. |
| `GET /questions/form/?evaluation=<id>` | Usuario autenticado. Devuelve categorías y criterios activos del formulario; `include_inactive=1` permite mostrar estructura histórica. |
| `GET`, `POST /questions/` | Lectura autenticada: jefes/superadmins consultan respuestas; colaboradores consultan las recibidas. Envían respuestas colaboradores y coordinadores (no el superadmin). |
| `GET /questions/sent/` | Colaborador o coordinador. Lista sus evaluaciones enviadas. |
| `GET /questions/submissions/` | Jefe o superadmin. Lista entregas agrupadas; acepta filtros `evaluation` y `personal`. |
| `GET /questions/quota/?evaluation=<id>` | Colaborador o coordinador. Devuelve límite, cupo usado, personas ya evaluadas y, si aplica, la lista asignada. |
| `GET`, `PUT /questions/settings/` | Jefe o superadmin. Consulta o configura el límite global o uno específico con `evaluation`; el rango permitido es 1–30. |
| `GET /questions/results/` | Usuario autenticado. Resultados propios agregados por formulario y categoría. |
| `GET /questions/results-summary/` | Jefe o superadmin. Resumen por persona y categoría; acepta `evaluation=<id>` o `evaluation=all`, y `kind=group\|self` para separar programaciones grupales e individuales. |
| `GET /questions/category-averages/` | Jefe o superadmin. Promedios por categoría; permite filtros `evaluation`, `personal`, `area`, `position` y fechas. |
| `GET /questions/dashboard/`, `GET /questions/stats/` | Usuario autenticado para dashboard; jefe o superadmin para estadísticas. Aceptan `date_from` y `date_to` en formato `YYYY-MM-DD`. |
| `POST /questions/import/` | Jefe o superadmin. Importa formularios desde Excel `.xlsx` o CSV. |
| `POST /questions/answers/import/` | Jefe o superadmin. Importa respuestas desde Excel `.xlsx` o CSV; `evaluation` puede indicar el formulario por defecto. |

La mayoría de las consultas de resultados aceptan filtros de fecha `date_from` y `date_to` (inclusive). Los permisos se verifican en las vistas del backend; la navegación del frontend no es un control de acceso.

### Importación de formularios y respuestas

La importación desde la interfaz/API de formularios (`POST /questions/import/`) requiere columnas `evaluation`, `category` y `question`; también reconoce encabezados equivalentes en español sin distinguir tildes, mayúsculas ni separadores. Una fila representa un criterio; se repiten el nombre de evaluación y categoría para agregar más criterios. Evaluaciones existentes se omiten, no se sobrescriben. El formulario importado por API queda asociado al jefe que realiza la carga.

La importación de respuestas (`POST /questions/answers/import/`) requiere `evaluation`, `collaborator`, `personal` y una columna por cada código de criterio. Cada fila representa una entrega completa de un colaborador a una persona en un formulario. La evaluación se identifica por ID o nombre; si la columna se deja vacía, se puede indicar el parámetro `evaluation` como valor predeterminado. Las filas inválidas se reportan y las entregas ya existentes no se duplican. Solo deben importarse archivos revisados y con datos autorizados; no incluir credenciales ni datos de prueba en archivos productivos.

El comando `python manage.py import_questions data/evaluations.xlsx` admite Excel y CSV. A diferencia de la carga por API, las evaluaciones creadas por el comando no tienen un jefe propietario; asígnales un propietario desde la administración antes de gestionarlas desde la aplicación. La lógica compartida está en `backend/questions/staff_import.py`.

## Módulo common

`backend/common/` reúne piezas compartidas por las aplicaciones del backend: autenticación JWT para solicitudes API, permisos por rol y paginación. Su configuración predeterminada está conectada en `config/settings/base.py`; las vistas pueden aplicar permisos o paginación más específicos cuando lo requiera el endpoint.

### Autenticación y CSRF

`CookieJWTAuthentication` (`common/authentication.py`) acepta JWT de dos formas:

1. En el encabezado `Authorization: Bearer <token>`, para clientes que administran explícitamente sus tokens.
2. En la cookie httpOnly `access_token`, usada por la aplicación web.

Cuando autentica desde cookie, valida también el token CSRF (patrón cookie + encabezado/formulario esperado por Django) en las solicitudes mutantes. Este control no se ejecuta en la rama del encabezado `Authorization`, que el navegador no agrega automáticamente. El frontend debe hacer las solicitudes autenticadas con el cliente común `frontend/src/lib/api.js`, que envía cookies y CSRF.

Si la cuenta tiene `password_change_required=True`, el autenticador responde 403 (`password_change_required`) en todos los endpoints salvo los de `PASSWORD_CHANGE_ALLOWED` (`me`, `password-change`, `logout`, `csrf-token`). Son nombres de URL: si se renombran, actualizar esa lista en `common/authentication.py`. Login, refresh, logout y csrf no usan el autenticador, así que la cuenta puede entrar y salir. Una autenticación válida no reemplaza los permisos de la vista, que se evalúan después.

Otras piezas de seguridad de `common/`: `security.py` (filtro de entradas maliciosas, `NoStoreApiMiddleware` y registro de intentos no autorizados) y `uploads.py` (validación de archivos subidos). Ver [Seguridad](#seguridad-25-capas).

### Permisos y pertenencia

`common/permissions.py` define permisos reutilizables:

| Permiso | Acceso |
| --- | --- |
| `IsSuperAdmin` | Solo el rol `superadmin`. |
| `IsCollaborator` | Participantes: `collaborator` y `boss` (evaluar, autoevaluarse, cupo, enviadas). |
| `IsBoss` | Solo el rol `boss`. |
| `IsBossOrSuperAdmin` | `boss` o `superadmin`; no implica que el jefe pueda modificar objetos de otros jefes. |

Los roles se comparan exactamente; no hay herencia implícita entre ellos. `MANAGER_ROLES` centraliza los roles que gestionan evaluaciones y `acts_as_manager(request)` decide si una petición recibe la vista de administración (un coordinador con `?participant=1` recibe la de colaborador). `owned_by(user, field="created_by")` devuelve el filtro de pertenencia: limita al jefe a objetos propios y no agrega esa restricción al superadmin. Las vistas deben combinar el permiso de rol con este filtro cuando operen sobre recursos que tienen propietario; `owned_by` por sí solo no autentica ni autoriza una solicitud.

### Paginación

`DefaultPagination` (`common/pagination.py`) usa paginación por número de página. En `REST_FRAMEWORK`, el tamaño predeterminado es 20; `?page_size=` permite solicitar otro tamaño hasta un máximo de 200 y `?page=` selecciona la página. Este paginador se aplica a endpoints que usan el paginador predeterminado de DRF (por ejemplo, vistas genéricas paginadas); una vista API personalizada que devuelve una lista directamente debe invocar la paginación explícitamente para producir una respuesta paginada.

## Módulos audit y realtime

La auditoría se emite como JSON a stdout **y** se guarda en la tabla `audit_auditevent` (los logs de Render no se conservan). El tiempo real no usa tablas.

### Auditoría (`backend/audit/`)

`AuditLogMixin` se integra en las vistas de usuarios y evaluaciones. Registra solicitudes mutantes (`POST`, `PUT`, `PATCH`, `DELETE`) con nombre de acción/endpoint, resultado HTTP, fecha, IP real del cliente (de `X-Forwarded-For` detrás de Render), navegador, y usuario/rol cuando existe. `common.security.log_unauthorized` agrega los intentos bloqueados como `security.<motivo>` con resultado `blocked` (contraseña incorrecta, entrada maliciosa, ventana privada…).

El modelo `audit.AuditEvent` es de **solo inserción**: `save()` sobre un evento existente, `delete()`, `QuerySet.update()` y `QuerySet.delete()` lanzan `AppendOnlyError`, y el admin de Django lo muestra solo para consulta y filtro. Si guardar un evento falla, se registra en el log y la petición continúa (savepoint propio).

No se registran cuerpos de solicitud/respuesta, contraseñas, cookies, encabezados de autorización ni tokens; por ello no es un respaldo de los datos de negocio, y no cubre modificaciones hechas fuera de la API (por ejemplo, edición directa en SQL). No hay depuración automática: definir la retención según la política de la clínica.

### Tiempo real (`backend/realtime/`)

`config/asgi.py` enruta HTTP a Django y `/ws/events/` a Django Channels. El WebSocket autentica el JWT de la cookie httpOnly `access_token`, valida el origen contra `ALLOWED_HOSTS` y limita conexiones a cuentas activas de tipo `boss`, `superadmin` o `collaborator` sin cambio de contraseña pendiente.

Redis (Channels) transporta eventos entre procesos; no almacena respuestas de evaluación ni el registro de auditoría. Los mensajes solo contienen el tipo de evento y su fecha, sin nombres, puntuaciones, identificadores de personas ni otros datos de evaluación. Los canales se agrupan por rol: los responsables reciben nuevas entregas; las evaluaciones nuevas o modificadas se anuncian a ambos grupos; cambios de personal se anuncian a responsables. El cliente debe volver a consultar la API autenticada para obtener información autorizada.

El frontend mantiene una conexión mientras hay sesión, reintenta con espera creciente si se interrumpe y renueva la sesión si el JWT expira. Vite reenvía `/ws/` al backend en desarrollo. En producción, el proxy HTTPS debe permitir el upgrade de WebSocket y enrutar `/ws/` al servicio ASGI Daphne, igual que `/api/`.

Ambos archivos Compose incluyen Redis sin publicar su puerto al host. Producción usa Daphne para servir HTTP y WebSocket desde ASGI. `CHANNELS_REDIS_URL` configura la capa de canales (por defecto, la base Redis 3); el tiempo real no usa modelos de base de datos.

## Cargas de archivos

### Personal

La pantalla "Cargar datos" acepta Excel `.xlsx` (máximo `UPLOAD_MAX_MB`, 5 MB) y ofrece "Descargar plantilla". El importador está en `backend/users/staff_import.py`. El encabezado debe incluir documento, nombres, área y cargo; apellidos y rol son opcionales. Los documentos duplicados se omiten, no se actualizan. Las cuentas nuevas reciben la contraseña inicial y deben cambiarla en su primer ingreso (ver [Importación y creación de cuentas](#importación-y-creación-de-cuentas)).

### Formularios de evaluación

La pantalla de staff acepta Excel `.xlsx` o CSV (validados por `common/uploads.py`: extensión, tamaño y contenido real). Una fila representa una pregunta e incluye las columnas `evaluation`, `category` y `question` (también se aceptan encabezados equivalentes en español). Se repiten evaluación y categoría para cada pregunta correspondiente. Las evaluaciones que ya existen se omiten; las nuevas se crean junto con categorías y preguntas.

También se pueden crear formularios desde la consola del backend:

```powershell
docker compose exec backend python manage.py import_questions data/evaluations.xlsx
```

El comando admite `.xlsx` y `.csv`. El archivo debe estar en el contenedor (por ejemplo, bajo `backend/data/`, que está montado como `/app/data`). La lógica compartida está en `backend/questions/staff_import.py` y el comando en `backend/questions/management/commands/import_questions.py`.

## Frontend

El frontend es una SPA React con rutas en `frontend/src/App.jsx`. `AuthProvider` consulta `/auth/me/` al iniciar; las rutas internas se muestran dentro de `Layout`, que redirige a `/login` cuando no hay sesión, muestra solo "Cambia tu contraseña" si la cuenta tiene la contraseña inicial y cierra la sesión tras `VITE_IDLE_TIMEOUT_MINUTES` (15) sin actividad. La ruta inicial lleva al dashboard para `boss`/`superadmin` y a la pantalla de evaluación para `collaborator`. `Layout.jsx` define el menú de cada rol: el coordinador ve además "Evaluar" y "Autoevaluación"; el superadmin ve el submenú "Usuarios" (Administrar / Crear usuario). Todos tienen el ícono de llave "Cambiar contraseña".

### Páginas y roles

| Archivo | Ruta | Uso principal |
| --- | --- | --- |
| `frontend/src/pages/LoginPage.jsx` | `/login` | Inicio de sesión. |
| `frontend/src/pages/DashboardPage.jsx` | `/` | Indicadores y promedios para jefes de área. |
| `frontend/src/pages/EvaluationPage.jsx` | `/evaluations`, `/self-evaluation` | Evaluar (grupales) y Autoevaluación (individuales); colaboradores y coordinadores. |
| `frontend/src/pages/ReviewPage.jsx` | (modal) | Detalle de las evaluaciones de una persona, abierto desde Resultados. |
| `frontend/src/pages/ResultsPage.jsx` | `/results` | Resultados por tipo de programación, evaluación, área, persona, cargo y fechas; resultado cualitativo; "Limpiar filtros"; exportar a Excel. |
| `frontend/src/pages/FormCreatePage.jsx` | `/create` | Creación y edición de formularios, categorías y preguntas. |
| `frontend/src/pages/FormProgramPage.jsx` | `/program`, `/program/individual` | Programar evaluaciones grupales o individuales (autoevaluación). |
| `frontend/src/pages/EvaluationsListPage.jsx` | `/evaluations-list` | Estado, avance, cierre y edición de programaciones. |
| `frontend/src/pages/UsersAdminPage.jsx` | `/users` | Superadmin: rol, inhabilitar y restablecer contraseña. |
| `frontend/src/pages/CreateUserPage.jsx` | `/users/create` | Superadmin: crear una cuenta con la contraseña inicial. |
| `frontend/src/pages/ChangePasswordPage.jsx` | `/account/password` | Cualquier usuario: cambiar su contraseña (también la pantalla obligatoria del primer ingreso). |
| `frontend/src/pages/StaffImportPage.jsx` | `/staff` | Superadmin: carga de personal (con plantilla descargable). |

Las rutas del menú se configuran en `components/Layout.jsx`; al agregar una pantalla, actualizar `App.jsx` y revisar también los enlaces por rol en el layout. Los componentes de interfaz reutilizables están en `components/ui/`; estilos compartidos de formularios, alertas y títulos en `components/ui/styles.js`. `components/ScoreTable.jsx` representa los criterios cuantitativos o descriptivos.

### Sesión y comunicación con la API

- `context/AuthContext.jsx` mantiene usuario, carga inicial, login, logout y `updateUser` (p. ej. tras cambiar la contraseña).
- `lib/useIdleLogout.js` cierra la sesión por inactividad (capa 20); la actividad se comparte entre pestañas.
- `lib/api.js` es el cliente común: usa `credentials: 'include'`, envía el token CSRF en mutaciones, serializa JSON y renueva una sesión vencida una vez.
- El backend entrega access y refresh como cookies httpOnly. No guardar tokens de sesión en `localStorage` ni hacer `fetch` directo para endpoints autenticados; usar `api()`.
- En desarrollo y producción, `lib/api.js` llama a `/api/v1` en el mismo origen del frontend. Vite reenvía `/api` al backend Docker local usando `VITE_API_URL`; Render reescribe `/api/*` hacia Django en producción. Así las cookies de autenticación son first-party.
- `lib/useEvaluationForms.js` centraliza la carga de formularios históricos para vistas que deben mostrar categorías o preguntas ya desactivadas.

### Convenciones para cambios

1. Mantener las llamadas HTTP en `lib/api.js` o en funciones cercanas a la página, usando el cliente `api()`.
2. Mostrar errores de API con `errorMessage()` y marcar mensajes de error con `role="alert"`.
3. Reutilizar `Button`, `Card`, `Badge` y las clases de `components/ui/styles.js` antes de crear variantes visuales nuevas.
4. Si se agrega una ruta, actualizar tanto el router como la navegación y verificar qué rol debe verla. El control visual del menú no sustituye permisos en el backend.
5. Para formularios de carga, usar `FormData` sin fijar manualmente el encabezado `Content-Type`; el navegador debe agregar el boundary multipart.

### Compilación y variables

`frontend/.env` define `VITE_API_URL=http://localhost:8001` para Docker local. En producción no se establece esta variable; el cliente usa `/api/v1` relativo y Render lo reescribe hacia Django.

Los scripts disponibles están en `frontend/package.json`:

```powershell
npm run dev
npm run build
npm run lint
```

## Persistencia y operaciones

El proyecto Compose usa el nombre `heroes_del_corazon_pabon` para aislar sus servicios de los demás proyectos. La base de datos existente se conserva en el volumen externo `heroes_api_postgres_data`; no se renombra ni se crea otro volumen automáticamente. La base configurada por defecto es `heroesdelcorazon` (los nombres de bases PostgreSQL distinguen mayúsculas y minúsculas). No usar `docker compose down -v` ni eliminar ese volumen si se deben conservar los datos.

Operaciones comunes desde `backend/`:

```powershell
docker compose ps
docker compose logs -f backend
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

### Transferencia inicial de PostgreSQL a SQL Server

La base de desarrollo continúa en PostgreSQL. Para la migración posterior, habilitar TCP/IP en la instancia local de SQL Server, crear una base destino vacía y un login SQL con permisos para crear tablas, y configurar `SQLSERVER_USER` y `SQLSERVER_PASSWORD` localmente. El override `docker-compose.sqlserver-migration.yml` permite hacer la transferencia sin cambiar el motor normal de desarrollo. El volumen PostgreSQL `heroes_api_postgres_data` se conserva.

```powershell
cd backend
docker compose up -d db
docker compose -f docker-compose.yml -f docker-compose.sqlserver-migration.yml run --rm --no-deps backend python manage.py transfer_postgres_to_sqlserver
```

Antes de actualizar un ambiente con datos, obtener y verificar una copia de seguridad PostgreSQL. Las migraciones se ejecutan automáticamente por `docker/entrypoint.sh` salvo que `RUN_MIGRATIONS` se desactive.

## Despliegue

`backend/docker-compose.prod.yml` define PostgreSQL y el backend Django/Gunicorn. Antes de levantarlo, aprovisionar `backend/.env` con credenciales privadas y configuración real del ambiente: `DJANGO_SECRET_KEY` aleatoria de al menos 50 caracteres, contraseñas seguras, hosts permitidos, dominio del sitio y configuración SMTP. Compose lee ese archivo automáticamente. No subirlo a Git ni reutilizar los valores locales de desarrollo. La configuración de producción fuerza `DEBUG=False`, HTTPS y cookies seguras.

En Render, configurar `DATABASE_URL` con la URL interna de PostgreSQL asociada al servicio. PostgreSQL es el motor predeterminado y Django usa esa URL antes de las variables `POSTGRES_*`; así no intenta conectar a `localhost:5432`. Mantener el Web Service y PostgreSQL en la misma región para usar la URL interna. Render documenta este flujo en [conexión a PostgreSQL](https://render.com/docs/postgresql-creating-connecting).

En producción, Render sirve el frontend y reescribe `/api/*` al backend `https://heroesdelcorazon-pabon.onrender.com/api/*`. No configures el origen público del backend en `VITE_API_URL` para producción: el cliente usa rutas relativas para que el navegador conserve las cookies. En el backend Render, configura `FRONTEND_BASE_URL` y `CSRF_TRUSTED_ORIGINS` con el origen HTTPS que Render asigne al frontend; después vuelve a desplegar el backend. La conexión directa entre dominios distintos puede hacer que el navegador bloquee las cookies de sesión.

El puerto del backend se publica solo en `127.0.0.1` del host para que un proxy TLS local pueda acceder a Gunicorn sin exponerlo directamente a Internet. Si el proxy corre en otro contenedor o servidor, usar una red privada y no publicar el puerto del backend en una interfaz pública; el proxy debe sobrescribir `X-Forwarded-Proto`.

Comando de despliegue desde `backend/`:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

El Compose de producción no incluye el frontend: servir el `dist/` generado por `npm run build` mediante el servidor web o proxy HTTPS del despliegue, y enrutar `/api/` al backend. Configurar persistencia y copias de seguridad de PostgreSQL fuera del ciclo de vida del contenedor.

## Mantenimiento

- Cambiar modelos: editar el modelo, crear migración con `python manage.py makemigrations` y revisar el archivo generado antes de aplicarlo.
- Añadir rutas: actualizar `urls.py`, vista y serializador correspondientes, cuidando autenticación y permisos.
- Modificar importaciones: mantener reglas de encabezados, duplicados y validación alineadas entre la pantalla staff y el comando cuando compartan lógica.
- Revisar seguridad de permisos en `backend/common/permissions.py` y en las vistas antes de exponer nuevas acciones.
- Mantener datos de ejemplo sintéticos y fuera de los despliegues productivos.

## Seguridad (25 capas)

Una clínica requiere como mínimo 7 capas de seguridad; este proyecto implementa 25. La guía para probar cada una a mano, con pasos y resultado esperado, está en [`reportes_pruebas_QA/PRUEBAS_MANUALES_SEGURIDAD.txt`](reportes_pruebas_QA/PRUEBAS_MANUALES_SEGURIDAD.txt).

| # | Capa | Dónde |
| --- | --- | --- |
| 1 | Política de contraseñas | `AUTH_PASSWORD_VALIDATORS` |
| 2 | Hash PBKDF2 con sal | Django |
| 3 | Bloqueo por fuerza bruta (usuario + IP) | django-axes, `LoginView` |
| 4 | Límite de peticiones | `DEFAULT_THROTTLE_RATES` |
| 5 | Tokens en cookies httpOnly / Secure / SameSite | `users/views.py`, `AUTH_COOKIE_*` |
| 6 | Rotación y lista negra de refresh tokens | `SIMPLE_JWT`, refresh/logout |
| 7 | Sesión ligada al dispositivo | `users/devices.py`, `enforce_device` |
| 8 | CSRF (doble cookie) | `common/authentication.py` |
| 9 | Control de acceso por rol en el servidor | `common/permissions.py` |
| 10 | Filtro de entradas maliciosas + ORM parametrizado | `MaliciousInputMiddleware` |
| 11 | Cabeceras de seguridad y CSP | `frontend/nginx/security-headers.conf`, settings |
| 12 | HTTPS obligatorio + HSTS | `prod.py` |
| 13 | CORS / orígenes de confianza exactos | `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` |
| 14 | Registro estructurado de auditoría y seguridad | `audit/logging.py` (+ Sentry si hay `SENTRY_DSN`) |
| 15 | Minimización de información: respuesta única `{"detail": "Acceso no autorizado.", "code": "unauthorized_access"}` en cualquier endpoint y método para 401/403/404/405/429 (y 400 sin sesión), sin cabecera `Allow`; el login no revela si la cuenta existe | `common/exceptions.py`, nginx `server_tokens off`, `DEBUG=False` |
| 16 | Gestión de secretos | variables de entorno; `prod.py` exige `DJANGO_SECRET_KEY` ≥ 50 |
| 17 | Bloqueo de ventanas privadas; abrir endpoints del backend en el navegador solo con sesión de `/django-admin/`; la app solo bajo `/admin/` y solo desde un navegador (nginx), con GET/HEAD; todo lo demás, "Acceso no autorizado." | `lib/privateMode.js`, `common/navigation.py`, `frontend/nginx/default.conf.template`, `lib/appBase.js` |
| 18 | Contraseña inicial con cambio obligatorio | `enforce_password_change`, `PasswordChangeView` |
| 19 | Ciclo de vida de cuentas (inhabilitar, ≥1 superadmin) | `AdminUsersView` |
| 20 | Cierre de sesión por inactividad | `frontend/src/lib/useIdleLogout.js` |
| 21 | Revocación de sesiones al cambiar la contraseña | `users/sessions.py` |
| 22 | Respuestas de la API sin caché (`no-store`) | `NoStoreApiMiddleware` |
| 23 | Auditoría persistente de solo inserción | `audit/models.py` `AuditEvent` |
| 24 | Validación de archivos subidos | `common/uploads.py` |
| 25 | Escaneo de vulnerabilidades en dependencias | `.github/workflows/*-ci.yml` (pip-audit, npm audit) |

Las capas 20 a 25 se agregaron el 2026-11-19. Al activar la capa 25 se actualizaron `djangorestframework` 3.18.0 → 3.18.2 y `daphne` 4.2.1 → 4.2.2 por vulnerabilidades conocidas.

**Pendientes que no dependen solo del código** (detalle en la guía de pruebas): copias de seguridad de la base de Render (plan gratuito, vence el 2026-12-10), la IP tomada del primer valor de `X-Forwarded-For`, el aviso de `xlsx` en npm y el contenedor del backend como root.

### Rutas públicas y respuesta única

| Dónde | Qué responde |
| --- | --- |
| Frontend `https://…-1.onrender.com/admin/...` | La app (login en `/admin/login`). Solo navegadores (cabecera `Sec-Fetch-Mode`) y solo GET/HEAD. |
| Frontend: cualquier otra ruta (`/`, `/login`, `/index.html`…) | 403 "Acceso no autorizado." (HTML en el navegador, JSON en Postman/curl). |
| Frontend: POST, PUT, PATCH, DELETE, OPTIONS fuera de `/api/` | 405 con el mismo cuerpo JSON, sin cabecera `Allow`. |
| Backend `/django-admin/` | Panel de Django (antes `/admin/`). |
| Backend `/api/...` | Reglas de la API; errores con el cuerpo único (`common/exceptions.py`). OPTIONS directo: 405 genérico; el preflight CORS legítimo sigue funcionando. |
| Backend: cualquier otra ruta (`/`, `/admin/`…) | El mismo cuerpo único. |
| `/healthz` (frontend y backend) | `{"status": "ok"}`: chequeo de salud de Render (`render.yaml`). Sin datos. |

**Inspeccionar (DevTools):** ningún sitio web puede impedirlo de verdad. En producción, `lib/devtoolsDeterrent.js` bloquea F12, Ctrl+Shift+I/J/C/K, Ctrl+U y el clic derecho fuera de los campos de texto. Es **disuasión**, no una capa de seguridad: la protección real es que el servidor no envía datos sin sesión válida. La detección "navegador o no" por `Sec-Fetch-Mode` también es disuasión (la cabecera se puede escribir a mano en Postman).

## Pruebas y calidad

Backend (dentro del contenedor):

```powershell
docker exec heroes_del_corazon_pabon-backend-1 python manage.py test questions.tests users --settings=config.settings.test
```

Se indica `questions.tests` (el paquete) porque en `questions/` conviven `tests.py` y `tests/`, y la etiqueta `questions` sola no se puede importar. Las pruebas de las capas de seguridad están en `users/test_security.py`, `users/test_security_layers.py` y `users/test_password_change.py`.

Frontend: `npx vitest run` ejecuta las pruebas, `npm run lint` ESLint y `npm run build` compila la aplicación.

CI (GitHub Actions): `backend-ci.yml` (lint, pruebas y `pip-audit`) y `frontend-ci.yml` (pruebas y `npm audit`).

## Documentos relacionados

- Requisitos funcionales e historias de usuario: documento Word del proyecto.
- La documentación técnica del proyecto se centraliza en este archivo raíz.
