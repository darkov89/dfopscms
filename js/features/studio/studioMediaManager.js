/**
 * DFCMS — Studio Media Manager (Wzorzec Attach)
 * Dołącza bezpośrednią obsługę podmiany zdjęć w podglądzie do instancji createStudioApp.
 * Zgodny z Anti-Monolith (wzorzec attach, brak arrow functions na metodach instancji).
 */
;(function (root) {
  "use strict";

  function attachStudioMediaManager(app) {
    if (!app || typeof app !== "object") return;

    app.mediaModalOpen = false;
    app.mediaTargetBlockId = null;
    app.mediaTargetPath = null;
    app.mediaCurrentUrl = "";
    app.mediaCustomUrl = "";
    app.mediaUploading = false;

    // Przykładowa biblioteka curated stock photos
    app.curatedStockPhotos = [
      { label: "Architektura / Wnętrza", url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80" },
      { label: "Studio / Kamera / Sprzęt", url: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=1200&q=80" },
      { label: "Twórca / Operator", url: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80" },
      { label: "Usługi / Fachowiec", url: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1200&q=80" },
      { label: "Gabinet / Zdrowie", url: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1200&q=80" },
      { label: "Biuro / Konsultacje", url: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80" },
    ];

    app.initMediaManager = function () {
      var self = this;
      window.addEventListener("message", function (e) {
        if (e.origin !== window.location.origin) return;
        if (!e.data || e.data.type !== "dfcms:pick-image") return;

        self.openMediaPicker(e.data.blockId, e.data.path, e.data.currentUrl);
      });
    };

    app.openMediaPicker = function (blockId, path, currentUrl) {
      this.mediaTargetBlockId = blockId;
      this.mediaTargetPath = path;
      this.mediaCurrentUrl = currentUrl || "";
      this.mediaCustomUrl = "";
      this.mediaModalOpen = true;
    };

    app.closeMediaPicker = function () {
      this.mediaModalOpen = false;
      this.mediaTargetBlockId = null;
      this.mediaTargetPath = null;
    };

    app.applySelectedImage = async function (imageUrl) {
      if (!imageUrl || !this.mediaTargetBlockId || !this.mediaTargetPath || !this.pageRow || !this.pageRow.draft_content) {
        this.closeMediaPicker();
        return;
      }

      var registry = root.DFOPS_customBlocksRegistry;
      if (!registry || typeof registry.applyBlockUpdate !== "function") return;

      this.pushDraftSnapshot();
      registry.applyBlockUpdate(this.pageRow.draft_content, this.mediaTargetBlockId, this.mediaTargetPath, imageUrl);

      var repo = root.DFOPS_pageRepository;
      if (repo && this.currentUser && this.pageId) {
        try {
          await repo.savePageByIdForOwner(this.currentUser.id, this.pageId, {
            draft_content: this.pageRow.draft_content,
          });
          this.refreshPreview();
          this.showToast("Zaktualizowano zdjęcie 📷");
        } catch (err) {
          console.error("[StudioMediaManager] Błąd zapisu zdjęcia:", err);
          this.showToast("Nie udało się zapisać nowego zdjęcia.");
        }
      }
      this.closeMediaPicker();
    };

    app.handleDirectFileUpload = async function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      event.target.value = "";

      if (!this.currentUser || !this.currentUser.id) {
        this.showToast("Musisz być zalogowany, aby wgrać zdjęcie.");
        return;
      }

      var maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        this.showToast("Plik jest za duży (maksymalnie 10 MB).");
        return;
      }

      var allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        this.showToast("Dozwolone formaty to JPG, PNG, WebP.");
        return;
      }

      var client = root.DFOPS_getSupabaseClient ? root.DFOPS_getSupabaseClient() : null;
      if (!client) {
        this.showToast("Brak połączenia z API.");
        return;
      }

      this.mediaUploading = true;
      try {
        var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        var path = this.currentUser.id + "/media_" + Date.now() + "." + ext;

        var uploadRes = await client.storage.from("images").upload(path, file, { cacheControl: "3600", upsert: false });
        if (uploadRes.error) throw uploadRes.error;

        var publicUrlData = client.storage.from("images").getPublicUrl(uploadRes.data.path);
        var publicUrl = publicUrlData && publicUrlData.data ? publicUrlData.data.publicUrl : "";

        if (publicUrl) {
          await this.applySelectedImage(publicUrl);
        } else {
          throw new Error("Nie udało się uzyskać adresu URL wgranego pliku.");
        }
      } catch (err) {
        console.error("[StudioMediaManager] Upload error:", err);
        this.showToast("Błąd uploadu: " + (err.message || "Spróbuj ponownie."));
      } finally {
        this.mediaUploading = false;
      }
    };
  }

  root.DFOPS_attachStudioMediaManager = attachStudioMediaManager;
})(typeof globalThis !== "undefined" ? globalThis : this);
