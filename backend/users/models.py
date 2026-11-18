from django.contrib.auth.models import AbstractUser, UserManager
from django.core.validators import RegexValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

# Solo se aceptan correos institucionales (dominio demo.com).
email_validator = RegexValidator(
    regex=r"^[a-zA-Z0-9._%+-]+@demo\.com$",
    message=_("Invalid email, you must use an institutional email."),
)


class CustomUserManager(UserManager):
    """Manager que fija roles por defecto: create_user -> collaborator, create_superuser -> superadmin."""

    def create_user(self,username,email=None,password=None,**extra_fields):
        extra_fields.setdefault("is_staff",False)
        extra_fields.setdefault("is_superuser",False)
        extra_fields.setdefault("role","collaborator")
        extra_fields.setdefault("is_active",True)
        return super().create_user(username,email,password,**extra_fields)
    
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff",True)
        extra_fields.setdefault("is_superuser",True)
        extra_fields.setdefault("role","superadmin")
        if extra_fields.get("is_staff") is not True:
            raise ValueError(_("El superusuario debe tener is_staff=True."))
        if extra_fields.get("is_superuser") is not True:
            raise ValueError(_("El superusuario debe tener is_superuser=True."))
        
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """Usuario del sistema. El login es por username (numero de documento), no por email.

        El rol (superadmin/boss/collaborator) gobierna los permisos en common/permissions.py.
        password_change_required fuerza el cambio de la clave temporal (ver CookieJWTAuthentication).
        """
    class Role(models.TextChoices):
        SUPERADMIN = "superadmin",_("Superadmin")
        BOSS = "boss", _("Area boss")
        COLLABORATOR = "collaborator", _("Collaborator")
        # Plain staff member who gets evaluated: not an evaluator (collaborator), boss or admin, and never signs in.
        PERSONAL = "personal", _("Evaluated staff")

    role = models.CharField(
        _("Role"),
        max_length=20,
        choices=Role.choices,
        default=Role.COLLABORATOR,
    )
    area = models.CharField(_("Area"), max_length=100, blank=True)
    position = models.CharField(_("Position"), max_length=100, blank=True)
    # Optional: people sign in with their ID number (username). Without an email no notifications are sent.
    email = models.EmailField(_("Institutional email"), unique=True, null=True, blank=True, validators=[email_validator])
    first_name = models.CharField(_("First name"), max_length=150)
    last_name = models.CharField(_("Last name"), max_length=150)
    password_change_required = models.BooleanField(default=False)
    # Doble autenticacion (TOTP). El secreto se genera en el primer login y se activa al confirmar un codigo.
    totp_secret = models.CharField(max_length=64, blank=True, default="")
    totp_enabled = models.BooleanField(default=False)
    # Ultimo paso de tiempo aceptado: un mismo codigo no se puede usar dos veces.
    totp_last_step = models.BigIntegerField(default=-1)
    # Freno a la fuerza bruta del codigo: intentos fallidos seguidos y bloqueo temporal.
    mfa_failed_attempts = models.PositiveSmallIntegerField(default=0)
    mfa_locked_until = models.DateTimeField(null=True, blank=True)

    objects = CustomUserManager()

    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        verbose_name = _("User")
        verbose_name_plural = _("Users")
        ordering = ["username"]
        indexes = [
            models.Index(fields=["email"], name="user_email_idx"),
        ]

    def save(self, *args, **kwargs):
        self.email = self.email or None  # "" would collide in the unique column
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.username}"


class TrustedDevice(models.Model):
    """Navegador/dispositivo registrado de un usuario.

    La sesion (JWT) queda ligada a este dispositivo: el identificador viaja en una cookie
    httpOnly y solo se guarda su hash. Un token robado sin la cookie del dispositivo no sirve.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="devices")
    token_hash = models.CharField(max_length=64, unique=True)
    user_agent = models.CharField(max_length=300, blank=True)
    ip_address = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now_add=True)
    revoked = models.BooleanField(default=False)
    # Momento en que este navegador supero la doble autenticacion; se le confia durante MFA_TRUST_DAYS.
    mfa_verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _("Trusted device")
        verbose_name_plural = _("Trusted devices")
        ordering = ["-last_seen"]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.pk}"
