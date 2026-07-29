#!/bin/sh
# L'image opentripplanner:2.5.0 n'expose pas de jar unique : elle est packagée
# avec jib (fichiers de classpath dans /app). On invoque OTP via ce classpath.
GRAPH=/var/opentripplanner/graph.obj
OTP="java $JAVA_OPTS -cp @/app/jib-classpath-file @/app/jib-main-class-file"
if [ -f "$GRAPH" ]; then
  echo "graph.obj trouvé — chargement rapide (~15s)"
  exec $OTP --load --serve /var/opentripplanner/
else
  echo "Pas de graph.obj — construction complète (~3min)"
  exec $OTP --build --save --serve /var/opentripplanner/
fi
