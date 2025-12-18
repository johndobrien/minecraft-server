FROM itzg/minecraft-server:latest

# Optional: Copy server data/configs if needed
# COPY ./data /data

# Expose the default Minecraft port
EXPOSE 25565

# The default CMD is already set in the base image to start the server
CMD ["/start"]
