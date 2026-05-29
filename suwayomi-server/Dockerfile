# https://github.com/Suwayomi/Suwayomi-Server-docker/pkgs/container/suwayomi-server
FROM ghcr.io/suwayomi/suwayomi-server:stable

USER root

COPY startup_script_org.sh /home/suwayomi/startup_script_org.sh
RUN chmod +x /home/suwayomi/startup_script_org.sh

EXPOSE 4567

ENTRYPOINT ["tini", "--"]
CMD ["/home/suwayomi/startup_script_org.sh"]

