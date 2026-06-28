from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('aeis_dashboard', '0004_processingjob'),
    ]

    operations = [
        migrations.AddField(
            model_name='aeisuser',
            name='position',
            field=models.CharField(
                blank=True,
                choices=[
                    ('student', 'Student'),
                    ('industry_professional', 'Industry Professional'),
                    ('researcher', 'Researcher'),
                    ('decision_maker', 'Decision Maker'),
                ],
                default='',
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name='aeisuser',
            name='role',
            field=models.CharField(
                choices=[
                    ('county', 'County officer'),
                    ('ministry', 'Ministry command officer'),
                    ('analyst', 'National analyst'),
                    ('field_officer', 'Field officer'),
                    ('farmer', 'Farmer / user'),
                    ('auditor', 'Auditor'),
                    ('public', 'Public user'),
                ],
                db_index=True,
                default='county',
                max_length=16,
            ),
        ),
    ]
