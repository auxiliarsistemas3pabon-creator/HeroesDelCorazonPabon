"""Copy every Django-managed row from PostgreSQL into an empty SQL Server database."""

import tempfile
from pathlib import Path

from django.apps import apps
from django.core.management import BaseCommand, call_command
from django.db import connections, router
from django.db.utils import NotSupportedError


class Command(BaseCommand):
    help = "Transfer Django data from source_postgres to the default SQL Server database."

    def handle(self, *args, **options):
        if "source_postgres" not in connections:
            self.stderr.write(
                self.style.ERROR(
                    "Configure SOURCE_POSTGRES_DB and SOURCE_POSTGRES_* connection variables first."
                )
            )
            return

        source = connections["source_postgres"]
        target = connections["default"]
        if source.vendor != "postgresql" or target.vendor != "microsoft":
            self.stderr.write(self.style.ERROR("Source must be PostgreSQL and default database must be SQL Server."))
            return

        # Create the target schema first, then ensure no application data can be overwritten.
        call_command("migrate", database="default", interactive=False, verbosity=options.get("verbosity", 1))
        populated_models = []
        for model in apps.get_models():
            if not model._meta.managed or model._meta.label_lower in {
                "contenttypes.contenttype",
                "auth.permission",
            }:
                continue
            if not router.allow_migrate_model("default", model):
                continue
            try:
                if model._base_manager.using("default").exists():
                    populated_models.append(model._meta.label)
            except NotSupportedError:
                continue
        if populated_models:
            self.stderr.write(
                self.style.ERROR(
                    "Target contains rows and was left unchanged: " + ", ".join(populated_models)
                )
            )
            return

        # The serialized fixture contains records only and lives in the OS temp folder.
        # It is deleted automatically, including if loading fails.
        with tempfile.TemporaryDirectory(prefix="heroes-db-transfer-") as temp_dir:
            fixture = Path(temp_dir) / "postgres-data.json"
            call_command(
                "dumpdata",
                database="source_postgres",
                all=True,
                natural_foreign=True,
                natural_primary=True,
                output=str(fixture),
                verbosity=0,
            )
            call_command(
                "loaddata",
                str(fixture),
                database="default",
                verbosity=options.get("verbosity", 1),
            )

        self.stdout.write(self.style.SUCCESS("Django-managed data transfer completed."))
