# Install the update

1. In the Supabase project used by your running B Chess app, open SQL Editor. Run the complete contents of `supabase/syndicate_profiles.sql` once. It extends the existing Syndicate tables from the previous release. Logos are small PNG thumbnails stored with the club row, so there is no new storage bucket to configure.
2. Publish the contents of the B-CHESS-S-main directory to the same hosting path as the current app. Keep index.html at the existing site root.
3. Reopen the site after the deployment. To verify the installed icon on a device that caches an older icon, also test a fresh installation.

Old groups keep their memberships and remain searchable without location filters. The previous schema recorded memberships without identifying the creator, so those groups keep an empty Captain field.

Country and subdivision names come from iso-codes (see locations/NOTICE). Tamil Nadu's 38 district choices use the Government of Tamil Nadu district directory at https://tndistricts.nic.in/. Outside Tamil Nadu, the form accepts a district name where applicable.
