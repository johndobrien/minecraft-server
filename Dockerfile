FROM itzg/minecraft-server:latest


WORKDIR /data
COPY ./mods ./mods

# Expose the default Minecraft port
EXPOSE 25565

# The default CMD is already set in the base image to start the server
CMD ["/start"]
